import express from "express";
import cors from "cors";
import morgan from "morgan";
import puppeteer from "puppeteer";
import NodeCache from "node-cache";
import fs from "fs";

async function getThumbnailImage(browser, code) {
  if (fs.existsSync("cache/" + code)) {
    return code;
  }

  console.log("GEN " + code + " (start)");
  const startTime = Date.now();
  const page = await browser.newPage();

  try {
    page.setViewport({ width: 1200, height: 600 });
    page.setDefaultTimeout(5000);

    if (process.env.DEBUG) {
      page
        .on("console", (message) =>
          console.log(
            `${message.type().substr(0, 3).toUpperCase()} ${message.text()}`
          )
        )
        .on("pageerror", ({ message }) => console.log(message))
        .on("response", (response) =>
          console.log(`${response.status()} ${response.url()}`)
        );
    }

    let extraArgs = "";
    if (process.env.BYTEBIN_URL) {
      extraArgs +=
        "&x-bytebin-url=" + encodeURIComponent(process.env.BYTEBIN_URL);
    }

    let sparkUrl = process.env.SPARK_URL || "https://spark.lucko.me/";

    const url = `${sparkUrl}x-render-thumbnail?code=${code}${extraArgs}`;
    await page.goto(url);

    // wait for react to render the thumbnail or a loading error
    await page.waitForSelector(".thumbnail, .loading-error");
    const success = await page.$(".thumbnail");

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

      await page.screenshot({ type: "png", path: `cache/${code}` });
    }

    console.log(`GEN ${code} (complete after ${Date.now() - startTime}ms)`);
    return code;
  } finally {
    await page.close();
  }
}

async function main() {
  console.log("starting puppeteer....");
  const browser = await puppeteer.launch(
    process.env.NODE_ENV === "production"
      ? {
          executablePath: "/usr/bin/chromium-browser",
          args: ["--no-sandbox"],
        }
      : {}
  );

  if (!fs.existsSync("cache")) {
    fs.mkdirSync("cache");
  }

  const app = express();
  app.use(morgan("dev"));
  app.use(cors());
  app.disable("x-powered-by");
  app.enable("trust proxy");

  const cache = new NodeCache({ stdTTL: 300, useClones: false });

  app.get("/:code", async (req, res) => {
    let code = req.params.code;

    if (code === "favicon.ico") {
      res.status(404);
      return;
    }

    if (code.endsWith(".png")) {
      code = code.slice(0, -4);
    }

    let thumbnail;
    try {
      let promise = cache.get(code);
      if (promise == undefined) {
        promise = getThumbnailImage(browser, code);
        cache.set(code, promise);
      }
      thumbnail = await promise;
    } catch (e) {
      console.error(e);
    }

    if (thumbnail) {
      res
        .contentType("png")
        .setHeader("Cache-Control", "public, max-age=86400")
        .sendFile(thumbnail, { root: "cache" });
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
