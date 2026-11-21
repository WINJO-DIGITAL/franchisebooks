// Records the homepage hero walkthrough on the synthetic demo account (run the demo seed and the production build first).
// Usage: node scripts/record-hero-demo.cjs, then encode the .webm into public/hero-demo.webm and .mp4 into public/hero-demo.mp4.
const { chromium } = require("playwright");
const path = require("path");
const OUT = process.env.HERO_OUT || "/tmp/hero-recording";
(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:3000",
    storageState: "tests/e2e/.auth/demo-owner.json",
    viewport: { width: 1280, height: 760 },
    recordVideo: { dir: OUT, size: { width: 1280, height: 760 } },
  });
  const page = await context.newPage();
  const stops = [
    ["/", 5000],
    ["/drivers", 4000],
    ["/earnings", 5000],
    ["/reports", 4000],
    ["/insights", 6000],
    ["/", 3000],
  ];
  for (const [url, wait] of stops) {
    await page.goto(url, { waitUntil: "networkidle" });
    await page.waitForTimeout(wait);
  }
  const video = page.video();
  await context.close();
  await browser.close();
  console.log("VIDEO", await video.path());
})().catch((e) => { console.error(e); process.exit(1); });
