// Maps RGBA pixels onto a fixed GIF palette.
//
// gifenc's own applyPalette looks colors up at rgb565 precision (32 levels
// for red and blue), which turns smooth dark gradients into visible steps.
// This matches at 7 bits per channel (128 levels) via a lookup cache, so
// the only banding left is the palette's own spacing. An optional ordered
// (Bayer) dither breaks up what remains; because the pattern is fixed to
// the screen it doesn't crawl from frame to frame the way error-diffusion
// dithering does.
var BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

export function createMapper(palette, dither){
  var n = palette.length;
  var pr = new Int32Array(n), pg = new Int32Array(n), pb = new Int32Array(n);
  for (var i = 0; i < n; i++){ pr[i] = palette[i][0]; pg[i] = palette[i][1]; pb[i] = palette[i][2]; }
  var cache = new Int16Array(1 << 21).fill(-1);
  var amp = dither || 0;

  function nearest(r, g, b){
    var best = 0, bestD = Infinity;
    for (var i = 0; i < n; i++){
      var dr = r - pr[i], dg = g - pg[i], db = b - pb[i];
      var d = dr * dr * 2 + dg * dg * 4 + db * db * 3;
      if (d < bestD){ bestD = d; best = i; }
    }
    return best;
  }

  return function map(rgba, width, height){
    var out = new Uint8Array(width * height);
    var p = 0;
    for (var y = 0; y < height; y++){
      var row = (y & 3) << 2;
      for (var x = 0; x < width; x++, p++){
        var o = p << 2;
        var r = rgba[o], g = rgba[o + 1], b = rgba[o + 2];
        if (amp){
          var d = (BAYER4[row | (x & 3)] - 7.5) * amp / 16;
          r += d; g += d; b += d;
          r = r < 0 ? 0 : r > 255 ? 255 : r | 0;
          g = g < 0 ? 0 : g > 255 ? 255 : g | 0;
          b = b < 0 ? 0 : b > 255 ? 255 : b | 0;
        }
        var key = ((r >> 1) << 14) | ((g >> 1) << 7) | (b >> 1);
        var idx = cache[key];
        if (idx < 0){ idx = nearest(r, g, b); cache[key] = idx; }
        out[p] = idx;
      }
    }
    return out;
  };
}
