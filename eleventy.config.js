export default function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy({ "src/images": "images", "src/fonts": "fonts", "src/css": "css", "src/js": "js" });
  eleventyConfig.addPassthroughCopy({ "src/robots.txt": "robots.txt" });

  // Wraps each word of a heading in a span, for the word-by-word reveal.
  eleventyConfig.addFilter("words", function (text) {
    var esc = function (t) { return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); };
    return String(text || "").split(" ").filter(Boolean).map(function (w) { return '<span class="w">' + esc(w) + "</span>"; }).join(" ");
  });
  eleventyConfig.addGlobalData("year", new Date().getFullYear());

  return {
    dir: { input: "src", output: "_site", data: "_data" },
    templateFormats: ["njk"]
  };
}
