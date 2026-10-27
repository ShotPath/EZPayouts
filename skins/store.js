// Where Chart Skins lives on the Chrome Web Store. Paste the extension's id
// (the 32 letters at the end of its store link) once the listing is live:
// the Chart Skins page then shows "Add to Chrome", and the Pro page connects
// the store version to your account without needing the extension's button.
// Empty: the page offers the zip download instead.
window.EZ_STORE = (function () {
  var id = "";
  return { id: id, url: id ? "https://chromewebstore.google.com/detail/" + id : "" };
})();
