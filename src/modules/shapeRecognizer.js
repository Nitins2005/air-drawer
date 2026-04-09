import modelData from '../../data/shape-model.json';

export class ShapeRecognizer {
  constructor() {
    this.model = modelData;
  }

  /**
   * Recognizes geometric shapes from stroke points and returns perfect shape points.
   * @param {Array<{x: number, y: number}>} points - Raw stroke points
   * @param {number} minPoints - Minimum points to consider (default 5)
   * @returns {{detected: boolean, type: string, perfectPoints: Array<{x: number, y: number}, confidence: number}}
   */
  recognize(points, minPoints = 5) {
    if (points.length < minPoints) return { detected: false };

    // 1. Extract features for ML model
    const features = this._extractMLFeatures(points);
    if (!features) return { detected: false };

    // 2. Predict using Neural Network
    const prediction = this._predict(features);
    console.log('Shape Recognition Prediction:', prediction);

    const { type, confidence } = prediction;

    // 3. Reject very low confidence or "no_shape"
    if (type === 'no_shape' || confidence < 0.4) {
      console.log('Shape rejected:', { type, confidence });
      return { detected: false };
    }

    // 4. Generate "perfect points" based on the predicted type
    const { centerX, centerY, maxDist } = this._getCenterAndScale(points);
    const normalized = points.map(p => ({
      x: (p.x - centerX) / maxDist,
      y: (p.y - centerY) / maxDist
    }));

    let result = { detected: false };

    if (type === 'circle') {
      result = this._detectCircle(normalized);
    } else if (type === 'triangle') {
      result = this._detectTriangle(normalized);
    } else if (type === 'square' || type === 'rectangle') {
      result = this._detectRectangle(normalized);
    } else if (type === 'line') {
      result = this._detectLine(points);
    }

    if (result.detected) {
      result.confidence = confidence;
      // Use ML type if it's more specific (e.g. square vs rectangle)
      if (type === 'square' || type === 'rectangle') result.type = type;

      if (result.type !== 'line') {
        result.perfectPoints = result.perfectPoints.map(p => ({
          x: p.x * maxDist + centerX,
          y: p.y * maxDist + centerY
        }));
      }
    } else {
      console.log(`ML predicted ${type} but geometric validation failed.`, prediction);
    }

    return result;
  }

  _predict(features) {
    const { network, normalization, categories } = this.model;
    const { means, stds } = normalization;
    const { w1, b1, w2, b2 } = network;

    // Normalize features
    const input = features.map((v, i) => (v - means[i]) / stds[i]);

    // Hidden layer (ReLU)
    const hidden = new Array(b1.length);
    for (let j = 0; j < b1.length; j++) {
      let sum = b1[j];
      for (let i = 0; i < input.length; i++) {
        sum += input[i] * w1[i][j];
      }
      hidden[j] = Math.max(0, sum);
    }

    // Output layer (Softmax)
    const logits = new Array(b2.length);
    for (let j = 0; j < b2.length; j++) {
      let sum = b2[j];
      for (let i = 0; i < hidden.length; i++) {
        sum += hidden[i] * w2[i][j];
      }
      logits[j] = sum;
    }

    // Softmax
    const maxLogit = Math.max(...logits);
    const exps = logits.map(l => Math.exp(l - maxLogit));
    const sumExps = exps.reduce((a, b) => a + b, 0);
    const probs = exps.map(e => e / sumExps);

    const maxProb = Math.max(...probs);
    const categoryIdx = probs.indexOf(maxProb);

    return {
      type: categories[categoryIdx],
      confidence: maxProb,
      allProbs: Object.fromEntries(categories.map((c, i) => [c, probs[i]]))
    };
  }

  _extractMLFeatures(points) {
    if (points.length < 3) return null;

    // AABB
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of points) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const w = maxX - minX || 1;
    const h = maxY - minY || 1;
    const canvasScale = Math.max(w, h);

    // Centroid and scale-normalized points
    const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
    const cy = points.reduce((s, p) => s + p.y, 0) / points.length;
    const norm = points.map(p => ({ x: (p.x - minX) / canvasScale, y: (p.y - minY) / canvasScale }));
    const ncx = (cx - minX) / canvasScale;
    const ncy = (cy - minY) / canvasScale;

    // 1: Aspect ratio
    const aspectRatio = Math.min(w, h) / Math.max(w, h);

    // 2-4: Radius statistics
    const radii = norm.map(p => Math.hypot(p.x - ncx, p.y - ncy));
    const avgR = radii.reduce((s, r) => s + r, 0) / radii.length;
    const stdR = Math.sqrt(radii.reduce((s, r) => s + (r - avgR) ** 2, 0) / radii.length);
    const cvR = avgR > 0.001 ? stdR / avgR : 1;
    const roundness = Math.max(...radii) > 0.001 ? Math.min(...radii) / Math.max(...radii) : 0;

    // 5: Edge proximity
    let totalEdgeDist = 0;
    const edgeCounts = [0, 0, 0, 0];
    const nw = w / canvasScale;
    const nh = h / canvasScale;
    for (const p of norm) {
      const dists = [p.x, nw - p.x, p.y, nh - p.y];
      const minIdx = dists.indexOf(Math.min(...dists));
      edgeCounts[minIdx]++;
      totalEdgeDist += Math.min(...dists);
    }
    const avgEdgeDist = totalEdgeDist / norm.length;
    const edgeCoverage = Math.min(...edgeCounts) / norm.length;

    // 6: Angular coverage
    const angles = norm.map(p => Math.atan2(p.y - ncy, p.x - ncx));
    angles.sort((a, b) => a - b);
    let maxGap = 0;
    for (let i = 1; i < angles.length; i++) {
      maxGap = Math.max(maxGap, angles[i] - angles[i - 1]);
    }
    if (angles.length > 1) {
      maxGap = Math.max(maxGap, 2 * Math.PI + angles[0] - angles[angles.length - 1]);
    }
    const angularCoverage = 1 - maxGap / (2 * Math.PI);

    // 7: Linearity
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

    // 8: Closure
    let pathLen = 0;
    for (let i = 1; i < points.length; i++) {
      pathLen += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    }
    const closureDist = Math.hypot(end.x - start.x, end.y - start.y);
    const closure = pathLen > 0 ? closureDist / pathLen : 1;

    // 9-10: Convex hull
    const hull = this._convexHull(norm);
    const hullArea = this._polygonArea(hull);
    const bboxArea = nw * nh;
    const areaRatio = bboxArea > 0 ? hullArea / bboxArea : 0;
    const hullPerimeter = this._polygonPerimeter(hull);
    const perimeterRatio = hullPerimeter > 0 ? pathLen / (canvasScale * hullPerimeter) : 1;

    // 11: Cornerness
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

    // 12: Point count
    const pointCountNorm = Math.min(points.length / 100, 1);

    return [
      aspectRatio, cvR, roundness, avgEdgeDist, edgeCoverage,
      angularCoverage, linearity, closure, areaRatio, perimeterRatio,
      cornerness, pointCountNorm
    ];
  }

  // ─────────────── Geometry Helpers ───────────────

  _convexHull(points) {
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

  _polygonArea(pts) {
    let area = 0;
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      area += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
    }
    return Math.abs(area) / 2;
  }

  _polygonPerimeter(pts) {
    let perim = 0;
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      perim += Math.hypot(pts[j].x - pts[i].x, pts[j].y - pts[i].y);
    }
    return perim;
  }

  _getCenterAndScale(points) {
    const centerX = points.reduce((sum, p) => sum + p.x, 0) / points.length;
    const centerY = points.reduce((sum, p) => sum + p.y, 0) / points.length;
    let maxDist = 0;
    for (const p of points) {
      const dx = p.x - centerX;
      const dy = p.y - centerY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > maxDist) maxDist = dist;
    }
    return { centerX, centerY, maxDist: maxDist || 1 };
  }

  _detectCircle(normPoints) {
    if (normPoints.length < 6) return { detected: false };

    const radii = normPoints.map(p => Math.sqrt(p.x * p.x + p.y * p.y));
    const avgR = radii.reduce((s, r) => s + r, 0) / radii.length;

    // Variance check
    const variance = radii.reduce((s, r) => s + (r - avgR) ** 2, 0) / radii.length;
    const cv = avgR > 0.001 ? Math.sqrt(variance) / avgR : 1;

    // Circles should be somewhat round
    if (cv > 0.45) return { detected: false };

    const numPoints = 36;
    const pts = Array.from({ length: numPoints }, (_, i) => ({
      x: Math.cos(i * 2 * Math.PI / numPoints) * avgR,
      y: Math.sin(i * 2 * Math.PI / numPoints) * avgR
    }));
    // Close the circle path
    pts.push({ ...pts[0] });

    return {
      detected: true,
      type: 'circle',
      perfectPoints: pts
    };
  }

  _detectRectangle(normPoints) {
    if (normPoints.length < 4) return { detected: false };

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of normPoints) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }

    // Measure proximity to edges
    let totalEdgeDist = 0;
    for (const p of normPoints) {
      totalEdgeDist += Math.min(
        Math.abs(p.x - minX), Math.abs(p.x - maxX),
        Math.abs(p.y - minY), Math.abs(p.y - maxY)
      );
    }
    const avgEdgeDist = totalEdgeDist / normPoints.length;
    const perimeter = 2 * (maxX - minX + maxY - minY);

    // If it's too far from a rectangle shape, reject
    if (avgEdgeDist / perimeter > 0.1) return { detected: false };

    return {
      detected: true,
      type: 'rectangle',
      perfectPoints: [
        { x: minX, y: minY },
        { x: maxX, y: minY },
        { x: maxX, y: maxY },
        { x: minX, y: maxY },
        { x: minX, y: minY } // Close path
      ]
    };
  }

  _detectTriangle(normPoints) {
    const corners = this._extractCorners(normPoints, 3);
    if (corners.length !== 3) return { detected: false };
    const ordered = this._orderCorners(corners);
    return {
      detected: true,
      type: 'triangle',
      perfectPoints: [...ordered, { ...ordered[0] }] // Close path
    };
  }

  _detectLine(points) {
    if (points.length < 3) return { detected: false };

    const start = points[0];
    const end = points[points.length - 1];
    const len = Math.hypot(end.x - start.x, end.y - start.y);
    if (len < 10) return { detected: false };

    // Perpendicular distance variance
    let variance = 0;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    for (const p of points) {
      const perpDist = Math.abs(dy * (p.x - start.x) - dx * (p.y - start.y)) / len;
      variance += perpDist * perpDist;
    }
    const avgVar = variance / points.length;

    // Lines should be mostly straight
    if (avgVar > 0.05 * len) return { detected: false };

    return {
      detected: true,
      type: 'line',
      perfectPoints: [start, end]
    };
  }

  _orderCorners(corners) {
    const cx = corners.reduce((s, c) => s + c.x, 0) / corners.length;
    const cy = corners.reduce((s, c) => s + c.y, 0) / corners.length;
    return corners.sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
  }

  _extractCorners(points, numCorners) {
    const directions = Array.from({ length: numCorners }, (_, i) => i * 2 * Math.PI / numCorners);
    const corners = [];
    for (const dir of directions) {
      let maxDist = -1;
      let bestPoint = points[0];
      for (const p of points) {
        const proj = p.x * Math.cos(dir) + p.y * Math.sin(dir);
        if (proj > maxDist) {
          maxDist = proj;
          bestPoint = p;
        }
      }
      corners.push(bestPoint);
    }
    return corners;
  }

  _pointToSegmentDist(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
    const nearX = a.x + t * dx, nearY = a.y + t * dy;
    return Math.hypot(p.x - nearX, p.y - nearY);
  }
}
