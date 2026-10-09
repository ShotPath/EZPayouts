// Builds a 256-color palette for ONE frame and maps its pixels onto it.
// Runs off the main thread so several frames quantize in parallel while
// the page keeps rendering; the main thread only writes the results.
import { quantize, applyPalette } from "./gifenc.esm.js";

self.onmessage = function(e){
  var msg = e.data;
  var rgba = new Uint8ClampedArray(msg.rgba);
  var palette = quantize(rgba, 256, { format: "rgb565" });
  var index = applyPalette(rgba, palette, "rgb565");
  self.postMessage({ id: msg.id, palette: palette, index: index }, [index.buffer]);
};
