// Palette building and pixel mapping for GIF export.
//
// buildPalette: gifenc's quantizer buckets colors at rgb565 precision (32
// levels for red and blue), so the near-black range a dark card is mostly
// made of collapsed into a handful of palette entries: on a typical card
// 62% of pixels were darker than 25 but only 9 of 255 colors were. Colors
// are quantized on a square-root curve instead, which spreads the shadows
// across many more buckets, then refined (k-means) against the real pixels
// so each palette color sits exactly where the image needs it.
//
// createMapper: matches pixels at 7 bits per channel (gifenc's applyPalette
// also works at rgb565) via a lookup cache. A light ordered (Bayer) dither
// breaks up banding in mid-tones; it fades out in the shadows, where it
// would only add grain and make blacks look lifted. The pattern is fixed
// to the screen, so it doesn't crawl from frame to frame.
var BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
var WR = 2, WG = 4, WB = 3;

function nearestIndex(pr, pg, pb, n, r, g, b){
  var best = 0, bestD = Infinity;
  for (var i = 0; i < n; i++){
    var dr = r - pr[i], dg = g - pg[i], db = b - pb[i];
    var d = dr * dr * WR + dg * dg * WG + db * db * WB;
    if (d < bestD){ bestD = d; best = i; }
  }
  return best;
}
function channels(palette){
  var n = palette.length;
  var pr = new Float64Array(n), pg = new Float64Array(n), pb = new Float64Array(n);
  for (var i = 0; i < n; i++){ pr[i] = palette[i][0]; pg[i] = palette[i][1]; pb[i] = palette[i][2]; }
  return { pr: pr, pg: pg, pb: pb, n: n };
}

// pixels: RGBA samples. quantize: gifenc's quantize function.
export function buildPalette(pixels, maxColors, quantize){
  var len = pixels.length;
  var curved = new Uint8ClampedArray(len);
  var toCurve = new Uint8Array(256), fromCurve = new Uint8Array(256);
  for (var v = 0; v < 256; v++){
    toCurve[v] = Math.round(255 * Math.sqrt(v / 255));
    fromCurve[v] = Math.round(255 * Math.pow(v / 255, 2));
  }
  for (var i = 0; i < len; i += 4){
    curved[i] = toCurve[pixels[i]];
    curved[i + 1] = toCurve[pixels[i + 1]];
    curved[i + 2] = toCurve[pixels[i + 2]];
    curved[i + 3] = 255;
  }
  var palette = quantize(curved, maxColors, { format: "rgb565" }).map(function(c){
    return [fromCurve[c[0]], fromCurve[c[1]], fromCurve[c[2]]];
  });

  // k-means refinement on a subsample, in plain RGB with the same weights
  // the mapper uses, so palette colors are true centroids of what they map.
  var total = len >> 2;
  var step = Math.max(1, Math.floor(total / 160000));
  for (var iter = 0; iter < 4; iter++){
    var ch = channels(palette);
    var sr = new Float64Array(ch.n), sg = new Float64Array(ch.n), sb = new Float64Array(ch.n), cnt = new Float64Array(ch.n);
    var cache = new Int16Array(1 << 21).fill(-1);
    for (var p = 0; p < total; p += step){
      var o = p << 2;
      var r = pixels[o], g = pixels[o + 1], b = pixels[o + 2];
      var key = ((r >> 1) << 14) | ((g >> 1) << 7) | (b >> 1);
      var k = cache[key];
      if (k < 0){ k = nearestIndex(ch.pr, ch.pg, ch.pb, ch.n, r, g, b); cache[key] = k; }
      sr[k] += r; sg[k] += g; sb[k] += b; cnt[k]++;
    }
    for (var c = 0; c < ch.n; c++){
      if (cnt[c]) palette[c] = [Math.round(sr[c] / cnt[c]), Math.round(sg[c] / cnt[c]), Math.round(sb[c] / cnt[c])];
    }
  }
  return palette;
}

export function createMapper(palette, dither){
  var ch = channels(palette);
  var cache = new Int16Array(1 << 21).fill(-1);
  var amp = dither || 0;

  return function map(rgba, width, height){
    var out = new Uint8Array(width * height);
    var p = 0;
    for (var y = 0; y < height; y++){
      var row = (y & 3) << 2;
      for (var x = 0; x < width; x++, p++){
        var o = p << 2;
        var r = rgba[o], g = rgba[o + 1], b = rgba[o + 2];
        if (amp){
          // Full strength from mid-tones up, none in deep shadows.
          var lum = (r * 3 + g * 6 + b) / 10;
          var shade = lum <= 12 ? 0 : (lum >= 60 ? 1 : (lum - 12) / 48);
          if (shade > 0){
            var d = (BAYER4[row | (x & 3)] - 7.5) * amp * shade / 16;
            r += d; g += d; b += d;
            r = r < 0 ? 0 : r > 255 ? 255 : r | 0;
            g = g < 0 ? 0 : g > 255 ? 255 : g | 0;
            b = b < 0 ? 0 : b > 255 ? 255 : b | 0;
          }
        }
        var key = ((r >> 1) << 14) | ((g >> 1) << 7) | (b >> 1);
        var idx = cache[key];
        if (idx < 0){ idx = nearestIndex(ch.pr, ch.pg, ch.pb, ch.n, r, g, b); cache[key] = idx; }
        out[p] = idx;
      }
    }
    return out;
  };
}
