// /Users/junseok/Projects/my-backend/puppeteerCookieManager.js

import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { randomDelay } from "./config/crawler.js"; 

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);



// New function to capture and save a screenshot
export async function saveScreenshot(page, filename = 'screenshot.png') {
  const fs = await import('fs');
  const path = await import('path');
  const dir = path.join(process.cwd(), 'screenshots');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir);
  }
  const filePath = path.join(dir, filename);
  await page.screenshot({ path: filePath });
  console.log(`[INFO] Screenshot saved at ${filePath}`);
}


/**
 * (A) Generate mobile cookies, store in mobileNaverCookies.json
 *     plus the chosen UA in the same JSON.
 */
export async function getMobileCookies(keyword = "서초맛집") {
  // You could randomize this from an array of "mobile UAs" if you'd like
  const MOBILE_UA =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) " +
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15A372 Safari/604.1";

  // Puppeteer config
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 390, height: 844 }, // iPhone-ish
  });

  try {
    const page = await browser.newPage();
    
    // (1) Set the mobile UA
    await page.setUserAgent(MOBILE_UA);

    // (2) Set additional “natural” HTTP headers.
    //     This replicates typical requests from a mobile Safari-like browser.
    await page.setExtraHTTPHeaders({
      "Accept":
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      // You can add more if needed, e.g. Sec-Fetch-* headers,
      // but sometimes it's safer to keep it minimal.
    });

    // (3) Go to m.naver.com
    await page.goto("https://m.naver.com", { waitUntil: "domcontentloaded" });

    // (4) Perform search
    await page.click("#MM_SEARCH_FAKE");
    await page.waitForSelector("#query");
    await page.type("#query", keyword, { delay: 100 });
    await page.keyboard.press("Enter");
    await page.waitForNavigation({ waitUntil: "domcontentloaded" });

    // (5) "펼쳐서 더보기"
    try {
      await page.waitForSelector("span.PNozS", { timeout: 100000 });
      await randomDelay(3, 4);
      await page.click("span.PNozS");
      await randomDelay(1, 4);

    } catch (e) {
      console.warn("[WARN] '펼쳐서 더보기' not found:", e.message);
    }

    // (6) "사당맛집" or any span.UPDKY
    try {
      await page.waitForSelector("span.UPDKY", { timeout: 10000 });
      const elements = await page.$$("span.UPDKY");
      await saveScreenshot(page, 'homepag1e.png');

      if (elements.length > 0) {
        await elements[0].click();
        await randomDelay(1, 4);
      } else {
        console.warn("[WARN] '사당맛집' span not found");
      }
      await saveScreenshot(page, 'homepag1e.png');

    } catch (e) {
      console.warn("[WARN] '사당맛집' wait fail:", e.message);
    }

    // (7) Collect cookies
    const cookies = await page.cookies();
    const output = {
      ua: MOBILE_UA,    // store the UA used
      cookies,          // array of cookie objects
    };

    const cookiePath = path.join(__dirname, "mobileNaverCookies.json");
    fs.writeFileSync(cookiePath, JSON.stringify(output, null, 2), "utf-8");

    console.log(`[INFO] Mobile cookies + UA saved to ${cookiePath}`);
  } catch (err) {
    console.error("[ERROR] getMobileCookies:", err);
  } finally {
    await browser.close();
  }
}

/**
 * (B) Generate PC cookies, store in pcNaverCookies.json
 *     plus the chosen UA in the same JSON.
 */
export async function getPCCookies(keyword = "사당맛집") {
  // PC UA example
  const PC_UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:110.0) Gecko/20100101 Firefox/110.0";

  const browser = await puppeteer.launch({
    headless: "new",
    defaultViewport: { width: 1280, height: 800 },
  });

  try {
    const page = await browser.newPage();
    
    // (1) Set PC UA
    await page.setUserAgent(PC_UA);

    // (2) Additional “realistic” headers for a desktop environment
    await page.setExtraHTTPHeaders({
      "Accept":
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    });

    // (3) Visit www.naver.com
    await page.goto("https://www.naver.com", { waitUntil: "domcontentloaded" });

    // (4) Search
    await page.waitForSelector("#query");
    await page.type("#query", keyword, { delay: 100 });
    await page.keyboard.press("Enter");

    await page.waitForNavigation({ waitUntil: "domcontentloaded" });
    await randomDelay(1, 4);

    // (5) "지도" tab
    try {
      await page.waitForSelector('a[role="tab"]', { timeout: 5000 });
      const tabElements = await page.$$('a[role="tab"]');
      let mapLink = null;

      for (const el of tabElements) {
        const linkText = await el.evaluate((node) => node.textContent.trim());
        if (linkText.includes("지도")) {
          mapLink = el;
          break;
        }
      }

      if (mapLink) {
        await mapLink.click();
        await randomDelay(1, 4);
      } else {
        console.warn("[WARN] '지도' tab not found");
      }
    } catch (e) {
      console.warn("[WARN] '지도' tab click fail:", e.message);
    }

    // (6) Collect cookies
    const cookies = await page.cookies();
    const output = {
      ua: PC_UA,
      cookies,
    };

    const cookiePath = path.join(__dirname, "pcNaverCookies.json");
    fs.writeFileSync(cookiePath, JSON.stringify(output, null, 2), "utf-8");

    console.log(`[INFO] PC cookies + UA saved to ${cookiePath}`);
  } catch (err) {
    console.error("[ERROR] getPCCookies:", err);
  } finally {
    await browser.close();
  }
}

/** 
 * Command line usage:
 *   node puppeteerCookieManager.js mobile
 *   node puppeteerCookieManager.js pc
 */
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  (async () => {
    const mode = process.argv[2] || "mobile";
    if (mode === "mobile") {
      await getMobileCookies("서초맛집");
    } else {
      await getPCCookies("사당맛집");
    }
    console.log("[INFO] Done.");
  })();
}