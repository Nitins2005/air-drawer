import { ShapeRecognizer } from './src/modules/shapeRecognizer.js';
const recognizer = new ShapeRecognizer();
const circle = Array.from({length: 30}, (_, i) => ({x: 100 + 50*Math.cos(2*Math.PI*i/30), y: 100 + 50*Math.sin(2*Math.PI*i/30)}));
const rect = [{x:10,y:10},{x:110,y:10},{x:110,y:60},{x:10,y:60},{x:10,y:10}];
const tri = [{x:10,y:10},{x:110,y:10},{x:60,y:90},{x:10,y:10}];
const line = [{x:10,y:10},{x:60,y:40},{x:110,y:70}];
for (const [name, pts] of Object.entries({circle, rect, tri, line})) {
  const result = recognizer.recognize(pts);
  console.log(name, result.detected, result.type, result.perfectPoints?.length);
}
