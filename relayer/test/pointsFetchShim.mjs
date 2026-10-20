const target = process.env.QA_POINTS_TARGET || "";
if (target) {
  const orig = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? String(input) : input && input.url;
    if (typeof url === "string" && url.startsWith("https://points.invalid")) {
      return orig(`${target.replace(/\/$/, "")}${url.slice("https://points.invalid".length)}`, init);
    }
    return orig(input, init);
  };
}
