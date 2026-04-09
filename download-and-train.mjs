/**
 * Downloads Google Quick, Draw! shape data and trains a lightweight shape classifier.
 * 
 * The classifier extracts 12 geometric features from stroke points and uses
 * a simple feedforward neural network trained on real hand-drawn shapes.
 * 
 * Output: data/shape-model.json (weights + means/stds for normalization)
 */

import https from 'https';
import http from 'http';
import fs from 'fs';
import path from 'path';

// ─────────────────── Configuration ───────────────────
const CATEGORIES = ['circle', 'square', 'triangle', 'line'];
const SAMPLES_PER_CATEGORY = 1000;
const TRAIN_SPLIT = 0.8;
const LEARNING_RATE = 0.001; // Reduced for stability
const EPOCHS = 200;
const HIDDEN_SIZE = 24;
const CLIP_VALUE = 0.5; // Gradient clipping to prevent explosion

// Quick, Draw! simplified NDJSON URLs
const BASE_URL = 'https://storage.googleapis.com/quickdraw_dataset/full/simplified';

// ─────────────────── Download ───────────────────
async function downloadCategory(category) {
  const url = `${BASE_URL}/${category}.ndjson`;
  const filePath = path.join('data', `${category}.ndjson`);

  if (fs.existsSync(filePath)) {
    console.log(`  ✓ ${category}.ndjson already exists, skipping download`);
    return filePath;
  }

  console.log(`  ↓ Downloading ${category} from Quick, Draw! ...`);

  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(filePath);
    let downloadedBytes = 0;
    let lines = 0;

    const makeRequest = (requestUrl) => {
      const client = requestUrl.startsWith('https') ? https : http;
      client.get(requestUrl, (response) => {
        // Handle redirects
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          makeRequest(response.headers.location);
          return;
        }

        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode} for ${category}`));
          return;
        }

        let buffer = '';
        response.on('data', (chunk) => {
          downloadedBytes += chunk.length;
          buffer += chunk.toString();

          // Process line by line, stop after enough samples
          while (buffer.includes('\n')) {
            const newlineIdx = buffer.indexOf('\n');
            const line = buffer.substring(0, newlineIdx);
            buffer = buffer.substring(newlineIdx + 1);

            if (line.trim()) {
              file.write(line + '\n');
              lines++;
            }

            if (lines >= SAMPLES_PER_CATEGORY) {
              response.destroy();
              file.end();
              console.log(`    Got ${lines} samples (${(downloadedBytes / 1024).toFixed(0)} KB)`);
              resolve(filePath);
              return;
            }
          }
        });

        response.on('end', () => {
          file.end();
          console.log(`    Got ${lines} samples (${(downloadedBytes / 1024).toFixed(0)} KB)`);
          resolve(filePath);
        });

        response.on('error', reject);
      }).on('error', reject);
    };

    makeRequest(url);
  });
}

// ─────────────────── Feature Extraction ───────────────────
function quickDrawToPoints(drawing) {
  // Quick, Draw! format: drawing = [[x_coords], [y_coords], [timestamps]], ...
  // Each element is a stroke. We flatten all strokes into one point array.
  const points = [];
  for (const stroke of drawing) {
    const xs = stroke[0];
    const ys = stroke[1];
    for (let i = 0; i < xs.length; i++) {
      points.push({ x: xs[i], y: ys[i] });
    }
  }
  return points;
}

function extractFeatures(points) {
  if (points.length < 3) return null;

  // Normalize to unit square
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const w = maxX - minX || 1;
  const h = maxY - minY || 1;
  const norm = points.map(p => ({ x: (p.x - minX) / Math.max(w, h), y: (p.y - minY) / Math.max(w, h) }));

  // Center
  const cx = norm.reduce((s, p) => s + p.x, 0) / norm.length;
  const cy = norm.reduce((s, p) => s + p.y, 0) / norm.length;

  // Feature 1: Aspect ratio
  const aspectRatio = Math.min(w, h) / Math.max(w, h);

  // Features 2-4: Radius statistics (for circularity)
  const radii = norm.map(p => Math.hypot(p.x - cx, p.y - cy));
  const avgR = radii.reduce((s, r) => s + r, 0) / radii.length;
  const stdR = Math.sqrt(radii.reduce((s, r) => s + (r - avgR) ** 2, 0) / radii.length);
  const cvR = avgR > 0.001 ? stdR / avgR : 1; // Coefficient of variation
  const roundness = Math.max(...radii) > 0.001 ? Math.min(...radii) / Math.max(...radii) : 0;

  // Feature 5: Edge proximity (how close points are to bounding box edges)
  let totalEdgeDist = 0;
  const edgeCounts = [0, 0, 0, 0]; // left, right, top, bottom
  const nw = w / Math.max(w, h);
  const nh = h / Math.max(w, h);
  for (const p of norm) {
    const dists = [p.x, nw - p.x, p.y, nh - p.y]; // distance to left, right, top, bottom
    const minIdx = dists.indexOf(Math.min(...dists));
    edgeCounts[minIdx]++;
    totalEdgeDist += Math.min(...dists);
  }
  const avgEdgeDist = totalEdgeDist / norm.length;
  const edgeCoverage = Math.min(...edgeCounts) / norm.length;

  // Feature 6: Angular coverage (for circles)
  const angles = norm.map(p => Math.atan2(p.y - cy, p.x - cx));
  angles.sort((a, b) => a - b);
  let maxGap = 0;
  for (let i = 1; i < angles.length; i++) {
    maxGap = Math.max(maxGap, angles[i] - angles[i - 1]);
  }
  if (angles.length > 1) {
    maxGap = Math.max(maxGap, 2 * Math.PI + angles[0] - angles[angles.length - 1]);
  }
  const angularCoverage = 1 - maxGap / (2 * Math.PI);

  // Feature 7: Linearity (perpendicular distance from start→end line)
  const start = points[0], end = points[points.length - 1];
  const lineLen = Math.hypot(end.x - start.x, end.y - start.y);
  let perpSum = 0;
  if (lineLen > 0.01) {
    const dx = end.x - start.x, dy = end.y - start.y;
    for (const p of points) {
      perpSum += Math.abs(dy * (p.x - start.x) - dx * (p.y - start.y)) / lineLen;
    }
  }
  const linearity = lineLen > 0.01 ? perpSum / points.length / lineLen : 1;

  // Feature 8: Closure (distance from last point to first point, relative to path length)
  let pathLen = 0;
  for (let i = 1; i < points.length; i++) {
    pathLen += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  const closureDist = Math.hypot(end.x - start.x, end.y - start.y);
  const closure = pathLen > 0 ? closureDist / pathLen : 1;

  // Feature 9-10: Convex hull area ratio & perimeter ratio
  const hull = convexHull(norm);
  const hullArea = polygonArea(hull);
  const bboxArea = nw * nh;
  const areaRatio = bboxArea > 0 ? hullArea / bboxArea : 0;
  const hullPerimeter = polygonPerimeter(hull);
  const perimeterRatio = hullPerimeter > 0 ? pathLen / (Math.max(w, h) * hullPerimeter) : 1;

  // Feature 11: Number of direction changes (cornerness)
  let dirChanges = 0;
  const windowSize = Math.max(3, Math.floor(points.length / 20));
  for (let i = windowSize; i < points.length - windowSize; i++) {
    const prev = Math.atan2(points[i].y - points[i - windowSize].y, points[i].x - points[i - windowSize].x);
    const next = Math.atan2(points[i + windowSize].y - points[i].y, points[i + windowSize].x - points[i].x);
    let diff = Math.abs(next - prev);
    if (diff > Math.PI) diff = 2 * Math.PI - diff;
    if (diff > 0.5) dirChanges++;
  }
  const cornerness = dirChanges / Math.max(1, points.length);

  // Feature 12: Point count (normalized)
  const pointCountNorm = Math.min(points.length / 100, 1);

  return [
    aspectRatio,      // 0
    cvR,              // 1: coefficient of variation of radii
    roundness,        // 2
    avgEdgeDist,      // 3
    edgeCoverage,     // 4
    angularCoverage,  // 5
    linearity,        // 6
    closure,          // 7
    areaRatio,        // 8
    perimeterRatio,   // 9
    cornerness,       // 10
    pointCountNorm,   // 11
  ];
}

// ─────────────────── Geometry Helpers ───────────────────
function convexHull(points) {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length <= 2) return pts;

  const cross = (O, A, B) => (A.x - O.x) * (B.y - O.y) - (A.y - O.y) * (B.x - O.x);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (const p of pts.reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

function polygonArea(pts) {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    area += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return Math.abs(area) / 2;
}

function polygonPerimeter(pts) {
  let perim = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    perim += Math.hypot(pts[j].x - pts[i].x, pts[j].y - pts[i].y);
  }
  return perim;
}

// ─────────────────── Simple Neural Network ───────────────────
class SimpleNN {
  constructor(inputSize, hiddenSize, outputSize) {
    this.w1 = this.randomMatrix(inputSize, hiddenSize, Math.sqrt(2 / inputSize));
    this.b1 = new Array(hiddenSize).fill(0);
    this.w2 = this.randomMatrix(hiddenSize, outputSize, Math.sqrt(2 / hiddenSize));
    this.b2 = new Array(outputSize).fill(0);
  }

  randomMatrix(rows, cols, scale) {
    const m = [];
    for (let i = 0; i < rows; i++) {
      m.push([]);
      for (let j = 0; j < cols; j++) {
        m[i].push((Math.random() * 2 - 1) * scale);
      }
    }
    return m;
  }

  relu(x) { return Math.max(0, x); }
  reluDeriv(x) { return x > 0 ? 1 : 0; }

  softmax(logits) {
    const maxLogit = Math.max(...logits);
    const exps = logits.map(l => {
      const e = Math.exp(l - maxLogit);
      return isFinite(e) ? e : 0;
    });
    const sum = exps.reduce((s, e) => s + e, 0) || 1e-10;
    return exps.map(e => e / sum);
  }

  forward(input) {
    const hidden = new Array(this.b1.length);
    for (let j = 0; j < this.b1.length; j++) {
      let sum = this.b1[j];
      for (let i = 0; i < input.length; i++) {
        sum += input[i] * this.w1[i][j];
      }
      hidden[j] = this.relu(sum);
    }

    const output = new Array(this.b2.length);
    for (let j = 0; j < this.b2.length; j++) {
      let sum = this.b2[j];
      for (let i = 0; i < hidden.length; i++) {
        sum += hidden[i] * this.w2[i][j];
      }
      output[j] = sum;
    }

    return { hidden, logits: output, probs: this.softmax(output) };
  }

  train(input, targetIdx, lr) {
    const { hidden, logits, probs } = this.forward(input);
    const dOutput = probs.map((p, i) => p - (i === targetIdx ? 1 : 0));

    const clip = (g) => Math.max(-CLIP_VALUE, Math.min(CLIP_VALUE, g));

    for (let j = 0; j < this.b2.length; j++) {
      const dj = clip(dOutput[j]);
      for (let i = 0; i < hidden.length; i++) {
        this.w2[i][j] -= lr * clip(dj * hidden[i]);
      }
      this.b2[j] -= lr * dj;
    }

    const dHidden = new Array(hidden.length).fill(0);
    for (let i = 0; i < hidden.length; i++) {
      let gradH = 0;
      for (let j = 0; j < this.b2.length; j++) {
        gradH += dOutput[j] * this.w2[i][j];
      }
      dHidden[i] = clip(gradH) * this.reluDeriv(hidden[i]);
    }

    for (let j = 0; j < this.b1.length; j++) {
      for (let i = 0; i < input.length; i++) {
        this.w1[i][j] -= lr * clip(dHidden[j] * input[i]);
      }
      this.b1[j] -= lr * clip(dHidden[j]);
    }

    return -Math.log(Math.max(1e-10, probs[targetIdx]));
  }

  export() {
    return { w1: this.w1, b1: this.b1, w2: this.w2, b2: this.b2 };
  }
}

// ─────────────────── Main Pipeline ───────────────────
async function main() {
  console.log('🎨 Shape Recognizer Training Pipeline\n');

  // 1. Download data
  console.log('1️⃣  Downloading Quick, Draw! data...');
  fs.mkdirSync('data', { recursive: true });

  for (const cat of CATEGORIES) {
    await downloadCategory(cat);
  }

  // 2. Load & extract features
  console.log('\n2️⃣  Extracting features...');
  const allFeatures = [];
  const allLabels = [];

  for (let catIdx = 0; catIdx < CATEGORIES.length; catIdx++) {
    const cat = CATEGORIES[catIdx];
    const filePath = path.join('data', `${cat}.ndjson`);
    const lines = fs.readFileSync(filePath, 'utf-8').split('\n').filter(l => l.trim());

    let extracted = 0;
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        if (!obj.recognized || !obj.drawing) continue;

        const points = quickDrawToPoints(obj.drawing);
        if (points.length < 5) continue;

        const features = extractFeatures(points);
        if (!features || features.some(f => isNaN(f) || !isFinite(f))) continue;

        allFeatures.push(features);
        allLabels.push(catIdx);
        extracted++;
      } catch (e) {
        // Skip malformed lines
      }
    }
    console.log(`  ${cat}: ${extracted} samples extracted`);
  }

  // Also add "no_shape" class with random/scribble data
  const NO_SHAPE_IDX = CATEGORIES.length;
  CATEGORIES.push('no_shape');
  const numScribbles = Math.floor(allFeatures.length / CATEGORIES.length);
  for (let i = 0; i < numScribbles; i++) {
    const numPoints = 10 + Math.floor(Math.random() * 50);
    const scribble = [];
    let x = Math.random() * 200, y = Math.random() * 200;
    for (let j = 0; j < numPoints; j++) {
      x += (Math.random() - 0.5) * 40;
      y += (Math.random() - 0.5) * 40;
      scribble.push({ x, y });
    }
    const features = extractFeatures(scribble);
    if (features && !features.some(f => isNaN(f) || !isFinite(f))) {
      allFeatures.push(features);
      allLabels.push(NO_SHAPE_IDX);
    }
  }
  console.log(`  no_shape: ${numScribbles} synthetic scribbles generated`);

  console.log(`\n  Total samples: ${allFeatures.length}`);

  // 3. Normalize features (z-score)
  console.log('\n3️⃣  Normalizing features...');
  const numFeatures = allFeatures[0].length;
  const means = new Array(numFeatures).fill(0);
  const stds = new Array(numFeatures).fill(0);

  for (const f of allFeatures) {
    for (let i = 0; i < numFeatures; i++) means[i] += f[i];
  }
  for (let i = 0; i < numFeatures; i++) means[i] /= allFeatures.length;

  for (const f of allFeatures) {
    for (let i = 0; i < numFeatures; i++) stds[i] += (f[i] - means[i]) ** 2;
  }
  for (let i = 0; i < numFeatures; i++) stds[i] = Math.sqrt(stds[i] / allFeatures.length) || 1;

  const normalized = allFeatures.map(f => f.map((v, i) => (v - means[i]) / stds[i]));

  // 4. Shuffle and split
  const indices = Array.from({ length: normalized.length }, (_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }

  const splitIdx = Math.floor(indices.length * TRAIN_SPLIT);
  const trainIdx = indices.slice(0, splitIdx);
  const testIdx = indices.slice(splitIdx);

  console.log(`  Train: ${trainIdx.length}, Test: ${testIdx.length}`);

  // 5. Train
  console.log(`\n4️⃣  Training neural network (${EPOCHS} epochs)...`);
  const nn = new SimpleNN(numFeatures, HIDDEN_SIZE, CATEGORIES.length);

  for (let epoch = 0; epoch < EPOCHS; epoch++) {
    // Shuffle training data each epoch
    for (let i = trainIdx.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [trainIdx[i], trainIdx[j]] = [trainIdx[j], trainIdx[i]];
    }

    let totalLoss = 0;
    for (const idx of trainIdx) {
      totalLoss += nn.train(normalized[idx], allLabels[idx], LEARNING_RATE);
    }

    if ((epoch + 1) % 20 === 0 || epoch === 0) {
      // Test accuracy
      let correct = 0;
      for (const idx of testIdx) {
        const { probs } = nn.forward(normalized[idx]);
        const predicted = probs.indexOf(Math.max(...probs));
        if (predicted === allLabels[idx]) correct++;
      }
      const acc = (correct / testIdx.length * 100).toFixed(1);
      console.log(`  Epoch ${(epoch + 1).toString().padStart(3)}: loss=${(totalLoss / trainIdx.length).toFixed(4)}, test_acc=${acc}%`);
    }
  }

  // 6. Final evaluation
  console.log('\n5️⃣  Final evaluation...');
  const confusion = Array.from({ length: CATEGORIES.length }, () => new Array(CATEGORIES.length).fill(0));
  for (const idx of testIdx) {
    const { probs } = nn.forward(normalized[idx]);
    const predicted = probs.indexOf(Math.max(...probs));
    confusion[allLabels[idx]][predicted]++;
  }

  console.log('\n  Confusion Matrix:');
  console.log('  ' + ' '.repeat(12) + CATEGORIES.map(c => c.padStart(10)).join(''));
  for (let i = 0; i < CATEGORIES.length; i++) {
    const row = confusion[i].map(v => v.toString().padStart(10)).join('');
    const total = confusion[i].reduce((a, b) => a + b, 0);
    const acc = total > 0 ? (confusion[i][i] / total * 100).toFixed(1) : '0.0';
    console.log(`  ${CATEGORIES[i].padStart(10)}: ${row}  (${acc}%)`);
  }

  const totalCorrect = confusion.reduce((s, row, i) => s + row[i], 0);
  const totalSamples = testIdx.length;
  console.log(`\n  Overall accuracy: ${(totalCorrect / totalSamples * 100).toFixed(1)}%`);

  // 7. Export model
  console.log('\n6️⃣  Exporting model...');
  const model = {
    categories: CATEGORIES,
    featureNames: [
      'aspectRatio', 'cvR', 'roundness', 'avgEdgeDist', 'edgeCoverage',
      'angularCoverage', 'linearity', 'closure', 'areaRatio', 'perimeterRatio',
      'cornerness', 'pointCountNorm'
    ],
    normalization: { means, stds },
    network: nn.export(),
    metadata: {
      trainSamples: trainIdx.length,
      testSamples: testIdx.length,
      accuracy: (totalCorrect / totalSamples * 100).toFixed(1),
      epochs: EPOCHS,
      hiddenSize: HIDDEN_SIZE,
    }
  };

  const modelPath = path.join('data', 'shape-model.json');
  fs.writeFileSync(modelPath, JSON.stringify(model));
  const sizeMB = (fs.statSync(modelPath).size / 1024).toFixed(1);
  console.log(`  ✅ Model saved to ${modelPath} (${sizeMB} KB)`);
  console.log('\n🎉 Done! Model is ready to use in the app.');
}

main().catch(console.error);
