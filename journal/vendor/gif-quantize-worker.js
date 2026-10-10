// Maps frames onto the GIF's shared palette off the main thread, so several
// frames are processed in parallel while the page keeps rendering.
import { createMapper } from "./gif-palette-map.js";

var map = null;

self.onmessage = function(e){
  var msg = e.data;
  if (msg.type === "palette"){
    map = createMapper(msg.palette, msg.dither);
    return;
  }
  var index = map(new Uint8ClampedArray(msg.rgba), msg.width, msg.height);
  self.postMessage({ id: msg.id, index: index }, [index.buffer]);
};
