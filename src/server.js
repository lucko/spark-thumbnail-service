import express from "express";
import cors from "cors";
import morgan from "morgan";
import puppeteer from "puppeteer";

async function getThumbnailImage(browser, code) {
  const page = await browser.newPage();

  page.setViewport({ width: 1200, height: 600 });
  page.setDefaultTimeout(5000);

  await page.goto(`http://spark.lucko.me/${code}?x-render-thumbnail=true`);

  // wait for react to render the thumbnail or a loading error
  await page.waitForSelector(".thumbnail, .loading-error");
  const success = await page.$(".thumbnail");

  let screenshotBuffer;

  if (success) {
    // wait until all images and fonts have loaded
    // ty github - https://github.blog/2021-06-22-framework-building-open-graph-images/
    await page.evaluate(async () => {
      const selectors = Array.from(document.querySelectorAll("img"));
      await Promise.all([
        document.fonts.ready,
        ...selectors.map((img) => {
          if (img.complete) {
            if (img.naturalHeight !== 0) return;
            throw new Error("Image failed to load");
          }
          return new Promise((resolve, reject) => {
            img.addEventListener("load", resolve);
            img.addEventListener("error", reject);
          });
        }),
      ]);
    });

    screenshotBuffer = await page.screenshot({ type: "png" });
  }

  await page.close();
  return screenshotBuffer;
}

async function main() {
  console.log("starting puppeteer....");
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/chromium-browser",
    args: ["--no-sandbox"],
  });

  const app = express();
  app.use(morgan("dev"));
  app.use(cors());
  app.disable("x-powered-by");
  app.enable("trust proxy");

  app.get("/:code", async (req, res) => {
    if (req.params.code === "favicon.ico") {
      res.status(404);
      return;
    }

    let thumbnail;
    try {
      thumbnail = await getThumbnailImage(browser, req.params.code);
    } catch (e) {
      console.error(e);
    }

    if (thumbnail) {
      res
        .contentType("png")
        .setHeader("Cache-Control", "public, max-age=86400")
        .send(thumbnail);
    } else {
      res.status(400).send("error");
    }
  });

  const port = 3000;
  const server = app.listen(port, () => {
    console.log("listening on port " + port);
  });

  async function stop() {
    console.log("shutdown signal received, stopping server");
    await browser.close();
    server.close(() => {
      console.log("bye!");
    });
  }

  process.on("SIGTERM", async () => await stop());
  process.on("SIGINT", async () => await stop());
}

(async () => {
  await main();
})();
