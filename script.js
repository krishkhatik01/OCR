/* ==========================================================================
   OCR ORDER EXTRACTOR
   FULL REPLACEMENT script.js

   Supports:
   1. GROCERY - PDF / labelled documents
   2. LIQUOR  - driver-app screenshots

   IMPORTANT OUTPUT RULES
   --------------------------------------------------------------------------
   ORDER NUMBER:
     Source: ORD-1049560280
     Display: ORD-1049560280
     Copy:    1049560280

   LIQUOR PHONE:
     Source: +64-223014127
     Output: 223014127

   DESTINATION:
     "11 Travers Place, Northpark, Auckland, 2013, New Zealand"
     becomes
     "11 Travers Place, Northpark, Auckland, 2013"

   LIQUOR and GROCERY use DIFFERENT parsers.
   Do NOT mix their field extraction logic.
   ========================================================================== */

(function () {
  "use strict";

  /* ========================================================================
     CONFIG
     ======================================================================== */

  const MAX_IMAGE_MB = 10;
  const MAX_PDF_MB = 15;

  const PDFJS_SCRIPT =
    "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js";

  const PDFJS_WORKER =
    "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";

  const TESSERACT_SCRIPT =
    "https://cdn.jsdelivr.net/npm/tesseract.js@5.0.5/dist/tesseract.min.js";

  /*
   * PSM 11 = Sparse text.
   *
   * This is important for LIQUOR screenshots because the driver app has
   * multiple visual columns.
   *
   * Example:
   *
   * Order #ORD-1049560280       Distance
   * +64-225387623               Call
   *
   * Normal OCR can merge these into one line.
   */
  const TESSERACT_PSM = "11";

  const NOT_FOUND = "[NOT FOUND]";

  const ACCEPTED_EXT = ["pdf", "jpg", "jpeg", "png", "webp"];

  /* ========================================================================
     DOM
     ======================================================================== */

  const el = (id) => document.getElementById(id);

  const orderTypeScreen = el("orderTypeScreen");
  const selectGroceryBtn = el("selectGroceryBtn");
  const selectLiquorBtn = el("selectLiquorBtn");

  const changeOrderTypeBtn = el("changeOrderTypeBtn");
  const modeIndicator = el("modeIndicator");

  const uploadScreen = el("uploadScreen");
  const dropZone = el("dropZone");
  const fileInput = el("fileInput");
  const selectFileBtn = el("selectFileBtn");
  const changeFileBtn = el("changeFileBtn");

  const fileInfo = el("fileInfo");
  const fileNameEl = el("fileName");
  const fileError = el("fileError");

  const extractBtn = el("extractBtn");

  const statusBox = el("statusBox");
  const statusText = el("statusText");

  const validationBox = el("validationBox");

  const resultScreen = el("resultScreen");
  const resultCard = el("resultCard");

  const copyAllBtn = el("copyAllBtn");

  const toggleRawBtn = el("toggleRawBtn");
  const rawOcrBody = el("rawOcrBody");
  const rawOcrText = el("rawOcrText");
  const copyRawBtn = el("copyRawBtn");

  const resetBtn = el("resetBtn");
  const toast = el("toast");

  /* ========================================================================
     STATE
     ======================================================================== */

  let selectedFile = null;

  /*
   * NEVER infer the extraction mode from OCR.
   *
   * User selects:
   *   grocery
   *   liquor
   *
   * before upload.
   */
  let selectedOrderType = null;

  let state = {
    fields: null,
    rawText: "",
    orderType: "",
  };

  /* ========================================================================
     SCRIPT LOADING
     ======================================================================== */

  const loadedScripts = new Map();

  let ocrWorker = null;
  let ocrWorkerPromise = null;

  function loadScript(src) {
    if (loadedScripts.has(src)) {
      return loadedScripts.get(src);
    }

    const promise = new Promise((resolve, reject) => {
      const script = document.createElement("script");

      script.src = src;
      script.async = true;

      script.onload = () => resolve();
      script.onerror = () => {
        reject(new Error("Failed to load external library."));
      };

      document.head.appendChild(script);
    });

    loadedScripts.set(src, promise);

    return promise;
  }

  async function ensurePdfJs() {
    if (window.pdfjsLib) {
      return window.pdfjsLib;
    }

    await loadScript(PDFJS_SCRIPT);

    window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;

    return window.pdfjsLib;
  }

  async function ensureTesseract() {
    if (window.Tesseract) {
      return window.Tesseract;
    }

    await loadScript(TESSERACT_SCRIPT);

    return window.Tesseract;
  }

  async function getOcrWorker() {
    if (ocrWorker) {
      return ocrWorker;
    }

    if (ocrWorkerPromise) {
      return ocrWorkerPromise;
    }

    ocrWorkerPromise = (async () => {
      const Tesseract = await ensureTesseract();

      const worker = await Tesseract.createWorker("eng");

      await worker.setParameters({
        tessedit_pageseg_mode: TESSERACT_PSM,

        /*
         * Preserve useful characters.
         */
        tessedit_char_whitelist:
          "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-#.,:/()%&' ",
      });

      ocrWorker = worker;

      return worker;
    })().catch((error) => {
      ocrWorker = null;
      ocrWorkerPromise = null;

      throw error;
    });

    return ocrWorkerPromise;
  }

  async function disposeOcrWorker() {
    const worker = ocrWorker;

    ocrWorker = null;
    ocrWorkerPromise = null;

    if (worker) {
      try {
        await worker.terminate();
      } catch (_) {}
    }
  }

  /* ========================================================================
     UI
     ======================================================================== */

  function showModeIndicator(mode) {
    if (!modeIndicator) return;

    modeIndicator.textContent =
      mode === "liquor"
        ? "Extraction mode: LIQUOR"
        : "Extraction mode: GROCERY";

    modeIndicator.classList.remove("hidden");
  }

  function goToOrderTypeScreen() {
    selectedOrderType = null;

    if (orderTypeScreen) {
      orderTypeScreen.classList.remove("hidden");
    }

    if (uploadScreen) {
      uploadScreen.classList.add("hidden");
    }

    if (modeIndicator) {
      modeIndicator.classList.add("hidden");
    }
  }

  function selectOrderType(mode) {
    selectedOrderType = mode;

    if (orderTypeScreen) {
      orderTypeScreen.classList.add("hidden");
    }

    if (uploadScreen) {
      uploadScreen.classList.remove("hidden");
    }

    showModeIndicator(mode);
  }

  if (selectGroceryBtn) {
    selectGroceryBtn.addEventListener("click", () => {
      selectOrderType("grocery");
    });
  }

  if (selectLiquorBtn) {
    selectLiquorBtn.addEventListener("click", () => {
      selectOrderType("liquor");
    });
  }

  if (changeOrderTypeBtn) {
    changeOrderTypeBtn.addEventListener("click", () => {
      selectedFile = null;

      if (fileInput) {
        fileInput.value = "";
      }

      if (fileInfo) {
        fileInfo.classList.add("hidden");
      }

      if (extractBtn) {
        extractBtn.classList.add("hidden");
      }

      clearFileError();

      goToOrderTypeScreen();
    });
  }

  function setStatus(message) {
    if (!statusBox || !statusText) return;

    statusBox.classList.remove("hidden");
    statusText.textContent = message;
  }

  function hideStatus() {
    if (statusBox) {
      statusBox.classList.add("hidden");
    }
  }

  function showFileError(message) {
    if (!fileError) return;

    fileError.textContent = message;
    fileError.classList.remove("hidden");
  }

  function clearFileError() {
    if (!fileError) return;

    fileError.textContent = "";
    fileError.classList.add("hidden");
  }

  /* ========================================================================
     FILE HANDLING
     ======================================================================== */

  function extOf(filename) {
    const match = /\.([a-z0-9]+)$/i.exec(filename || "");

    return match ? match[1].toLowerCase() : "";
  }

  function handleFileSelected(file) {
    clearFileError();

    if (!file) return;

    const ext = extOf(file.name);

    if (!ACCEPTED_EXT.includes(ext)) {
      showFileError(
        "Unsupported file type. Please upload PDF, JPG, PNG or WEBP.",
      );
      return;
    }

    const sizeMb = file.size / (1024 * 1024);

    if (ext === "pdf" && sizeMb > MAX_PDF_MB) {
      showFileError(`PDF is too large. Maximum size is ${MAX_PDF_MB} MB.`);
      return;
    }

    if (ext !== "pdf" && sizeMb > MAX_IMAGE_MB) {
      showFileError(`Image is too large. Maximum size is ${MAX_IMAGE_MB} MB.`);
      return;
    }

    selectedFile = file;

    if (fileNameEl) {
      fileNameEl.textContent = file.name;
    }

    if (fileInfo) {
      fileInfo.classList.remove("hidden");
    }

    if (extractBtn) {
      extractBtn.classList.remove("hidden");
    }

    /*
     * Warm up OCR immediately.
     */
    void getOcrWorker().catch(() => {});
  }

  if (selectFileBtn && fileInput) {
    selectFileBtn.addEventListener("click", () => {
      fileInput.click();
    });
  }

  if (fileInput) {
    fileInput.addEventListener("change", (event) => {
      const file = event.target.files && event.target.files[0];

      handleFileSelected(file);
    });
  }

  if (changeFileBtn && fileInput) {
    changeFileBtn.addEventListener("click", () => {
      selectedFile = null;

      fileInput.value = "";

      if (fileInfo) {
        fileInfo.classList.add("hidden");
      }

      if (extractBtn) {
        extractBtn.classList.add("hidden");
      }

      clearFileError();
    });
  }

  if (dropZone) {
    ["dragenter", "dragover"].forEach((eventName) => {
      dropZone.addEventListener(eventName, (event) => {
        event.preventDefault();

        dropZone.classList.add("drag-over");
      });
    });

    ["dragleave", "drop"].forEach((eventName) => {
      dropZone.addEventListener(eventName, (event) => {
        event.preventDefault();

        dropZone.classList.remove("drag-over");
      });
    });

    dropZone.addEventListener("drop", (event) => {
      const file =
        event.dataTransfer &&
        event.dataTransfer.files &&
        event.dataTransfer.files[0];

      if (file) {
        handleFileSelected(file);
      }
    });
  }

  /* ========================================================================
     IMAGE PREPROCESSING
     ======================================================================== */

  function loadImageFromFile(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);

      const img = new Image();

      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Could not read image."));
      };

      img.src = url;
    });
  }

  function preprocessImage(img) {
    /*
     * Keep resolution high enough for OCR but avoid huge processing.
     */
    const MAX_DIM = 1800;

    let width = img.naturalWidth || img.width;
    let height = img.naturalHeight || img.height;

    let scale = 1;

    if (Math.max(width, height) > MAX_DIM) {
      scale = MAX_DIM / Math.max(width, height);
    }

    const canvas = document.createElement("canvas");

    canvas.width = Math.max(1, Math.round(width * scale));

    canvas.height = Math.max(1, Math.round(height * scale));

    const ctx = canvas.getContext("2d", {
      willReadFrequently: true,
    });

    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    const pixels = imageData.data;

    /*
     * Mild grayscale + contrast.
     * Do not over-process because the driver app screenshot is already clean.
     */
    const contrast = 1.12;

    for (let i = 0; i < pixels.length; i += 4) {
      let gray =
        0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];

      gray = (gray - 128) * contrast + 128;

      gray = Math.max(0, Math.min(255, gray));

      pixels[i] = gray;
      pixels[i + 1] = gray;
      pixels[i + 2] = gray;
    }

    ctx.putImageData(imageData, 0, 0);

    return canvas;
  }

  /* ========================================================================
     PDF EXTRACTION
     ======================================================================== */

  function reconstructPdfLines(content) {
    const items = content.items.filter((item) => item.str && item.str.trim());

    const rows = [];

    const Y_TOLERANCE = 3;

    for (const item of items) {
      const x = item.transform[4];
      const y = item.transform[5];

      let row = rows.find((r) => Math.abs(r.y - y) <= Y_TOLERANCE);

      if (!row) {
        row = {
          y,
          cells: [],
        };

        rows.push(row);
      }

      row.cells.push({
        x,
        str: item.str,
      });
    }

    rows.sort((a, b) => b.y - a.y);

    return rows
      .map((row) => {
        row.cells.sort((a, b) => a.x - b.x);

        return row.cells
          .map((cell) => cell.str)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
      })
      .filter(Boolean);
  }

  async function extractFromPdf(file) {
    const pdfjsLib = await ensurePdfJs();

    const buffer = await file.arrayBuffer();

    const pdf = await pdfjsLib.getDocument({
      data: buffer,
    }).promise;

    const pageTexts = [];

    let nativePages = 0;
    let ocrPages = 0;

    let worker = null;

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);

      const content = await page.getTextContent();

      const lines = reconstructPdfLines(content);

      const nativeText = lines.join("\n");

      /*
       * If PDF already contains real text,
       * don't waste time with OCR.
       */
      if (nativeText.replace(/\s/g, "").length >= 20) {
        pageTexts.push(nativeText);

        nativePages++;

        continue;
      }

      /*
       * Scanned PDF page.
       */
      if (!worker) {
        setStatus("Reading scanned PDF...");

        worker = await getOcrWorker();
      }

      ocrPages++;

      const viewport = page.getViewport({
        scale: 1.5,
      });

      const canvas = document.createElement("canvas");

      canvas.width = Math.ceil(viewport.width);

      canvas.height = Math.ceil(viewport.height);

      const ctx = canvas.getContext("2d");

      await page.render({
        canvasContext: ctx,
        viewport,
      }).promise;

      const result = await worker.recognize(canvas);

      pageTexts.push(result.data.text);
    }

    return {
      text: pageTexts.join("\n\n"),

      method: ocrPages > 0 ? "PDF native + OCR fallback" : "PDF native text",

      debug: {
        pagesProcessed: pdf.numPages,

        nativeTextPages: nativePages,

        ocrPages,
      },
    };
  }

  /* ========================================================================
     IMAGE OCR
     ======================================================================== */

  async function extractFromImage(file) {
    const img = await loadImageFromFile(file);

    const canvas = preprocessImage(img);

    const worker = await getOcrWorker();

    const result = await worker.recognize(canvas);

    return {
      text: result.data.text || "",

      method: "Image OCR - PSM 11",

      debug: {
        pageSegMode: TESSERACT_PSM,

        ocrPasses: 1,
      },
    };
  }

  /* ========================================================================
     OCR LINE CLEANING
     ======================================================================== */

  function cleanLines(rawText) {
    if (!rawText) {
      return [];
    }

    let lines = rawText
      .split(/\r?\n/)
      .map((line) =>
        line
          .replace(/\u00a0/g, " ")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .filter(Boolean);

    const UI_CHROME =
      /^(home|new|active|call|take picture|map|cancel|dispatched|profile|past trips|accept|decline|navigate|start trip|end trip|complete|in progress)$/i;

    lines = lines.filter((line) => {
      if (/^https?:\/\//i.test(line)) {
        return false;
      }

      if (/^www\./i.test(line)) {
        return false;
      }

      if (/^page\s+\d+(\s+of\s+\d+)?$/i.test(line)) {
        return false;
      }

      /*
       * Phone status-bar clock.
       */
      if (/^\d{1,2}:\d{2}\s?(am|pm)?$/i.test(line)) {
        return false;
      }

      /*
       * Status-bar network.
       */
      if (/^(4g|5g|lte|wifi|wi-fi)$/i.test(line)) {
        return false;
      }

      /*
       * Battery.
       */
      if (/^\d{1,3}%$/.test(line)) {
        return false;
      }

      if (UI_CHROME.test(line)) {
        return false;
      }

      /*
       * Single-character icon OCR.
       */
      if (line.length === 1) {
        return false;
      }

      return true;
    });

    /*
     * Avoid duplicate OCR lines.
     */
    const seen = new Map();

    const result = [];

    for (const line of lines) {
      const count = (seen.get(line) || 0) + 1;

      seen.set(line, count);

      if (count <= 2) {
        result.push(line);
      }
    }

    return result;
  }

  /* ========================================================================
     COMMON NORMALIZATION
     ======================================================================== */

  function normalizeSpaces(value) {
    if (!value) return "";

    return String(value).replace(/\s+/g, " ").trim();
  }

  function normalizeDestinationAddress(value) {
    if (!value) {
      return "";
    }

    let result = normalizeSpaces(value);

    /*
     * REMOVE ONLY THE TRAILING COUNTRY.
     *
     * This works for:
     * New Zealand
     * NEW ZEALAND
     * , New Zealand
     */
    result = result.replace(/[\s,]*new\s+zealand\s*$/i, "");

    /*
     * Remove trailing comma / spaces.
     */
    result = result.replace(/[\s,]+$/, "");

    return result.trim();
  }

  function cleanPhone(raw) {
    if (!raw) {
      return "";
    }

    let value = String(raw).trim();

    /*
     * Remove +64 / 64 country prefix.
     *
     * +64-223014127
     * +64 223014127
     * 64223014127
     *
     * becomes:
     * 223014127
     */
    value = value.replace(/^\+?\s*64[\s-]*/i, "");

    /*
     * Remove all remaining non-digits.
     */
    value = value.replace(/\D/g, "");

    return value;
  }

  function cleanOrderNumber(raw) {
    if (!raw) {
      return "";
    }

    let value = String(raw).trim();

    /*
     * Remove common labels.
     */
    value = value.replace(/^order\s*(#|no\.?|number|id)\s*:?\s*/i, "");

    /*
     * CRITICAL:
     *
     * If OCR gives:
     *
     * ORD-1049560280 Distance
     *
     * only keep:
     *
     * ORD-1049560280
     */
    const token = value.match(/[A-Za-z]{0,5}[-]?\d{3,}/);

    if (token) {
      return token[0];
    }

    /*
     * Pure number fallback.
     */
    const number = value.match(/\d{3,}/);

    return number ? number[0] : "";
  }

  /*
   * COPY ONLY THE NUMERIC ORDER ID.
   *
   * ORD-1049560280
   * ->
   * 1049560280
   */
  function orderNumberForCopy(value) {
    if (!value) {
      return "";
    }

    if (value === NOT_FOUND) {
      return "";
    }

    const digits = String(value).match(/\d+/);

    return digits ? digits[0] : String(value).trim();
  }

  function upper(value) {
    return value ? String(value).toUpperCase() : "";
  }

  function required(value) {
    return value ? upper(value) : NOT_FOUND;
  }

  function optional(value) {
    return value ? upper(value) : "";
  }

  /* ========================================================================
     PHONE DETECTION
     ======================================================================== */

  /*
   * IMPORTANT:
   *
   * DO NOT search every random 8-12 digit sequence in the entire OCR.
   *
   * That can accidentally find digits from:
   *   order number
   *   date
   *   postcode
   *   distance
   *
   * Phone detection therefore happens primarily at the beginning of a line.
   *
   * Supported examples:
   *
   * +64-223014127
   * +64 223014127
   * +64-064211123091
   * 064211123091
   * 0223014127
   */
  const PHONE_START_RE =
    /^\s*(\+?\s*64[\s-]*)?(0\d[\d\s-]{7,12}\d|\d[\d\s-]{7,12}\d)/;

  function extractPhoneFromLine(line) {
    if (!line) {
      return "";
    }

    const match = line.match(PHONE_START_RE);

    if (!match) {
      return "";
    }

    return cleanPhone(match[0]);
  }

  function findCustomerNameAndPhone(lines) {
    /*
     * First pass:
     * Find the strongest phone candidate.
     */
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      const phone = extractPhoneFromLine(line);

      if (!phone) {
        continue;
      }

      /*
       * Name is usually immediately above phone.
       */
      let name = null;

      for (let j = i - 1; j >= 0 && j >= i - 3; j--) {
        const candidate = lines[j];

        if (!candidate) {
          continue;
        }

        if (
          /^(order|distance|pickup|delivery|driver|order instruction|items)/i.test(
            candidate,
          )
        ) {
          break;
        }

        if (/\d/.test(candidate)) {
          continue;
        }

        if (candidate.length < 2) {
          continue;
        }

        name = candidate;

        break;
      }

      return {
        name,
        phone,
      };
    }

    return {
      name: null,
      phone: null,
    };
  }

  /* ========================================================================
     ADDRESS HELPERS
     ======================================================================== */

  const STREET_WORDS =
    /\b(road|rd|street|st|drive|dr|parade|lane|ln|avenue|ave|highway|hwy|place|pl|court|ct|crescent|cres|way|terrace|close)\b/i;

  function isPlausibleAddress(value) {
    if (!value) {
      return false;
    }

    const clean = normalizeSpaces(value);

    if (clean.length < 8) {
      return false;
    }

    /*
     * Address normally contains a number or street word.
     */
    return /\d/.test(clean) || STREET_WORDS.test(clean);
  }

  function isPhoneLine(line) {
    return !!extractPhoneFromLine(line);
  }

  function isStructuralLine(line) {
    if (!line) {
      return false;
    }

    return (
      /delivery\s*location/i.test(line) ||
      /pickup\s*location/i.test(line) ||
      /^driver\s*instructions?$/i.test(line) ||
      /^order\s*instructions?$/i.test(line) ||
      /^items?\s+to\s+be\s+delivered$/i.test(line) ||
      /^cancel$/i.test(line) ||
      /^dispatched$/i.test(line)
    );
  }

  function collectAfterHeader(lines, index, maxLines) {
    const values = [];

    for (let i = index + 1; i < lines.length && values.length < maxLines; i++) {
      const line = lines[i];

      if (isStructuralLine(line)) {
        break;
      }

      if (isPhoneLine(line)) {
        break;
      }

      if (/^estimate\s+(pickup|delivery)?\s*time/i.test(line)) {
        break;
      }

      if (/^items?\s+to\s+be\s+delivered/i.test(line)) {
        break;
      }

      values.push(line.replace(/,\s*$/, ""));
    }

    return values;
  }

  function findHeaderIndex(lines, regex) {
    return lines.findIndex((line) => regex.test(line));
  }

  /* ========================================================================
     LIQUOR - ORDER NUMBER
     ======================================================================== */

  /*
   * Supports:
   *
   * Order #ORD-1049560280
   * Order #95785
   * Order no 95785
   * Order number 95785
   *
   * Also handles OCR merge:
   *
   * Order #ORD-1049560280 Distance
   */
  const LIQUOR_ORDER_INLINE_RE =
    /order\s*(?:#|no\.?|number|id)\s*:?\s*([A-Za-z0-9-]+)/i;

  const LIQUOR_ORDER_LABEL_RE = /^order\s*(?:#|no\.?|number|id)\s*:?\s*$/i;

  function findLiquorOrderNumber(lines) {
    /*
     * Pass 1:
     * Search every line for the order label.
     */
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      const inline = line.match(LIQUOR_ORDER_INLINE_RE);

      if (inline) {
        const candidate = cleanOrderNumber(inline[1]);

        if (candidate) {
          return candidate;
        }
      }

      /*
       * OCR may split:
       *
       * Order #
       * ORD-1049560280
       */
      if (LIQUOR_ORDER_LABEL_RE.test(line)) {
        for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
          const candidate = cleanOrderNumber(lines[j]);

          if (
            candidate &&
            !/^(distance|km|customer|pickup|delivery)$/i.test(candidate)
          ) {
            return candidate;
          }
        }
      }
    }

    /*
     * Pass 2:
     * More tolerant OCR.
     *
     * Handles:
     * "Order ORD-1049560280"
     * "Order# ORD-1049560280"
     */
    for (const line of lines) {
      const match = line.match(
        /order\s*#?\s*(?:no\.?|number)?\s*:?\s*([A-Za-z0-9-]*\d{3,})/i,
      );

      if (match) {
        const candidate = cleanOrderNumber(match[1]);

        if (candidate) {
          return candidate;
        }
      }
    }

    return null;
  }

  /* ========================================================================
     LIQUOR - PICKUP
     ======================================================================== */

  const PICKUP_LOCATION_RE = /pickup\s*location/i;

  function stripOCRIconPrefix(value) {
    if (!value) {
      return "";
    }

    /*
     * Example:
     * "Je Liquor Auckland Manurewa"
     *
     * -> "Liquor Auckland Manurewa"
     */
    return value.replace(/^\s*[|Il1ioOS5]{1,3}\s+(?=[A-Z])/, "").trim();
  }

  function splitLiquorPickup(lines) {
    const index = findHeaderIndex(lines, PICKUP_LOCATION_RE);

    if (index === -1) {
      return {
        store: null,
        address: null,
      };
    }

    const collected = collectAfterHeader(lines, index, 6);

    if (!collected.length) {
      return {
        store: null,
        address: null,
      };
    }

    /*
     * Remove obvious icon-noise lines before
     * identifying store.
     */
    const cleaned = collected.filter((line) => {
      const text = line.trim();

      if (text.length <= 2) {
        return false;
      }

      /*
       * Pure icon-like OCR.
       */
      if (/^[|Il1ioOS5]{1,3}$/i.test(text)) {
        return false;
      }

      return true;
    });

    if (!cleaned.length) {
      return {
        store: null,
        address: null,
      };
    }

    let store = null;
    let addressLines = [];

    /*
     * If first line looks like address,
     * there is no separate store name.
     */
    const first = stripOCRIconPrefix(cleaned[0]);

    const firstLooksAddress =
      /^\d+\s+/.test(first) &&
      (STREET_WORDS.test(first) || /\b\d{4}\b/.test(first));

    if (firstLooksAddress) {
      addressLines = cleaned;
    } else {
      store = first;

      addressLines = cleaned.slice(1);
    }

    const address = addressLines.length ? addressLines.join(", ") : null;

    return {
      store: store && store.length >= 3 ? store : null,

      address: isPlausibleAddress(address)
        ? normalizeDestinationAddress(address)
        : null,
    };
  }

  /* ========================================================================
     LIQUOR - DELIVERY ADDRESS
     ======================================================================== */

  const DELIVERY_LOCATION_RE = /delivery\s*location/i;

  function extractLiquorDeliveryAddress(lines) {
    const index = findHeaderIndex(lines, DELIVERY_LOCATION_RE);

    if (index === -1) {
      return null;
    }

    const values = collectAfterHeader(lines, index, 6);

    if (!values.length) {
      return null;
    }

    const address = values.join(", ");

    if (!isPlausibleAddress(address)) {
      return null;
    }

    return normalizeDestinationAddress(address);
  }

  /* ========================================================================
     LIQUOR - DISTANCE
     ======================================================================== */

  const DISTANCE_RE = /^(\d+(?:\.\d+)?)\s*km$/i;

  function findLiquorDistance(lines) {
    for (const line of lines) {
      const match = line.match(DISTANCE_RE);

      if (match) {
        return `${parseFloat(match[1])} KM`;
      }
    }

    /*
     * Fallback for:
     * "Distance 13.31 KM"
     */
    for (const line of lines) {
      const match = line.match(/distance[^\d]*(\d+(?:\.\d+)?)\s*km/i);

      if (match) {
        return `${parseFloat(match[1])} KM`;
      }
    }

    return null;
  }

  /* ========================================================================
     LIQUOR - ITEMS
     ======================================================================== */

  const ITEMS_HEADER_RE = /^items?\s+to\s+be\s+delivered/i;

  const ITEM_QTY_RE = /^x\s*(\d+)$/i;

  function extractLiquorItems(lines) {
    const index = findHeaderIndex(lines, ITEMS_HEADER_RE);

    if (index === -1) {
      return [];
    }

    const items = [];

    let pendingName = null;

    for (let i = index + 1; i < lines.length; i++) {
      const line = lines[i];

      /*
       * Items end when buttons / other blocks begin.
       */
      if (/^cancel$/i.test(line) || /^dispatched$/i.test(line)) {
        break;
      }

      const qty = line.match(ITEM_QTY_RE);

      if (qty) {
        if (pendingName) {
          items.push({
            name: pendingName.trim(),

            qty: parseInt(qty[1], 10),
          });

          pendingName = null;
        }

        continue;
      }

      /*
       * Ignore obvious UI junk.
       */
      if (/^(call|take picture|map)$/i.test(line)) {
        continue;
      }

      pendingName = pendingName ? `${pendingName} ${line}` : line;
    }

    return items;
  }

  /* ========================================================================
     LIQUOR - INSTRUCTIONS
     ======================================================================== */

  function extractLiquorInstruction(lines) {
    const headers = [/^order\s*instructions?$/i, /^driver\s*instructions?$/i];

    for (const header of headers) {
      const index = findHeaderIndex(lines, header);

      if (index === -1) {
        continue;
      }

      const values = collectAfterHeader(lines, index, 2);

      if (values.length) {
        return values.join(", ");
      }
    }

    return null;
  }

  /* ========================================================================
     LIQUOR - MAIN PARSER
     ======================================================================== */

  function extractLiquorOrder(lines) {
    const orderNo = findLiquorOrderNumber(lines);

    const customer = findCustomerNameAndPhone(lines);

    const pickup = splitLiquorPickup(lines);

    const destination = extractLiquorDeliveryAddress(lines);

    const distance = findLiquorDistance(lines);

    const items = extractLiquorItems(lines);

    const instructions = extractLiquorInstruction(lines);

    /*
     * Email is uncommon in driver screenshot,
     * but still support it.
     */
    const emailMatch = lines
      .join(" ")
      .match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);

    const email = emailMatch ? emailMatch[0] : null;

    return {
      raw: {
        name: customer.name,

        email,

        mobile: customer.phone,

        customerAddress: destination,

        vendorName: pickup.store,

        vendorAddress: pickup.address,

        orderNo,

        distanceRaw: distance,

        deliveryType: null,

        deliveryDate: null,

        deliveryTime: null,

        allowSubstitute: null,

        orderInstructions: instructions,

        orderSize: null,

        comment: null,

        items,
      },

      orderType: "LIQUOR",

      ocrOrderType: "LIQUOR",

      addressAmbiguous: false,
    };
  }

  /* ========================================================================
     GROCERY - LABELS
     ======================================================================== */

  const SECTION_HEADER_RE =
    /^(customer(\s+(details|information))?|vendor(\s+details)?|store(\s+name)?|supermarket|retailer|supplier|products?|items?|order\s+details|order\s+summary|additional\s+details|delivery|summary|payment)\s*:?\s*$/i;

  const GROCERY_LABELS = {
    name: {
      header: [
        /^full\s*name\s*:?\s*$/i,
        /^name\s*:?\s*$/i,
        /^customer\s*name\s*:?\s*$/i,
      ],

      inline: [
        /^full\s*name\s*:?\s+(.+)$/i,
        /^customer\s*name\s*:?\s+(.+)$/i,
        /^name\s*:?\s+(.+)$/i,
      ],
    },

    mobile: {
      header: [
        /^mobile\s*number\s*:?\s*$/i,
        /^mobile\s*:?\s*$/i,
        /^phone\s*number\s*:?\s*$/i,
        /^phone\s*:?\s*$/i,
        /^contact(\s*number)?\s*:?\s*$/i,
      ],

      inline: [
        /^mobile\s*number\s*:?\s+(.+)$/i,
        /^mobile\s*:?\s+(.+)$/i,
        /^phone\s*number\s*:?\s+(.+)$/i,
        /^phone\s*:?\s+(.+)$/i,
        /^contact(\s*number)?\s*:?\s+(.+)$/i,
      ],
    },

    email: {
      header: [/^email(\s*address)?\s*:?\s*$/i, /^e-mail\s*:?\s*$/i],

      inline: [/^email(\s*address)?\s*:?\s+(.+)$/i, /^e-mail\s*:?\s+(.+)$/i],
    },

    address: {
      header: [
        /^(delivery\s*)?address\s*:?\s*$/i,
        /^customer\s*address\s*:?\s*$/i,
      ],

      inline: [
        /^(delivery\s*)?address\s*:?\s+(.+)$/i,
        /^customer\s*address\s*:?\s+(.+)$/i,
      ],
    },

    orderNo: {
      header: [
        /^order\s*(id|no\.?|number)\s*:?\s*$/i,
        /^order\s*#\s*:?\s*$/i,
        /^reference\s*:?\s*$/i,
      ],

      inline: [
        /^order\s*(id|no\.?|number)\s*:?\s+(.+)$/i,
        /^order\s*#\s*:?\s+(.+)$/i,
        /^reference\s*:?\s+(.+)$/i,
      ],
    },

    distance: {
      header: [/^distance(\s*\(?km\)?)?\s*:?\s*$/i],

      inline: [/^distance(\s*\(?km\)?)?\s*:?\s+(.+)$/i],
    },

    deliveryType: {
      header: [/^delivery\s*type\s*:?\s*$/i, /^delivery\s*method\s*:?\s*$/i],

      inline: [
        /^delivery\s*type\s*:?\s+(.+)$/i,
        /^delivery\s*method\s*:?\s+(.+)$/i,
      ],
    },

    deliveryDate: {
      header: [/^(delivery|pickup)\s*date\s*:?\s*$/i, /^date\s*:?\s*$/i],

      inline: [
        /^(delivery|pickup)\s*date\s*:?\s+(.+)$/i,
        /^date\s*:?\s+(.+)$/i,
      ],
    },

    deliveryTime: {
      header: [/^(delivery|pickup)?\s*time\s*:?\s*$/i],

      inline: [/^(delivery|pickup)?\s*time\s*:?\s+(.+)$/i],
    },

    allowSubstitute: {
      header: [
        /^allow\s*substitute\s*:?\s*$/i,
        /^substitutes?\s*allowed\s*:?\s*$/i,
        /^substitution\s*:?\s*$/i,
      ],

      inline: [
        /^allow\s*substitute\s*:?\s+(.+)$/i,
        /^substitutes?\s*allowed\s*:?\s+(.+)$/i,
        /^substitution\s*:?\s+(.+)$/i,
      ],
    },

    orderInstructions: {
      header: [
        /^order\s*instructions?\s*:?\s*$/i,
        /^instructions?\s*:?\s*$/i,
        /^special\s*instructions?\s*:?\s*$/i,
      ],

      inline: [
        /^order\s*instructions?\s*:?\s+(.+)$/i,
        /^instructions?\s*:?\s+(.+)$/i,
        /^special\s*instructions?\s*:?\s+(.+)$/i,
      ],
    },

    orderSize: {
      header: [/^order\s*size\s*:?\s*$/i, /^size\s*:?\s*$/i],

      inline: [/^order\s*size\s*:?\s+(.+)$/i, /^size\s*:?\s+(.+)$/i],
    },

    comment: {
      header: [/^comments?\s*:?\s*$/i, /^notes?\s*:?\s*$/i],

      inline: [/^comments?\s*:?\s+(.+)$/i, /^notes?\s*:?\s+(.+)$/i],
    },
  };

  const WIDE_GROCERY_LABELS = {
    pickupAddress: {
      header: [/^(pick\s*up|pickup|collection|store)\s*address\s*:?\s*$/i],

      inline: [/^(pick\s*up|pickup|collection|store)\s*address\s*:?\s+(.+)$/i],
    },

    destinationAddress: {
      header: [/^(destination|delivery|customer)\s*address\s*:?\s*$/i],

      inline: [/^(destination|delivery|customer)\s*address\s*:?\s+(.+)$/i],
    },
  };

  function isSectionHeader(line) {
    return SECTION_HEADER_RE.test(line);
  }

  function isAnyGroceryLabel(line) {
    if (isSectionHeader(line)) {
      return true;
    }

    const fields = [
      ...Object.values(GROCERY_LABELS),

      ...Object.values(WIDE_GROCERY_LABELS),
    ];

    return fields.some((field) =>
      field.header.some((regex) => regex.test(line)),
    );
  }

  function extractGroceryValue(lines, field) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      /*
       * Inline value.
       */
      for (const regex of field.inline) {
        const match = line.match(regex);

        if (match) {
          const value = match[match.length - 1];

          if (value && value.trim()) {
            return value.trim();
          }
        }
      }

      /*
       * Header only.
       */
      const isHeader = field.header.some((regex) => regex.test(line));

      if (!isHeader) {
        continue;
      }

      /*
       * Label:value
       */
      const colon = line.indexOf(":");

      if (colon !== -1) {
        const value = line.slice(colon + 1).trim();

        if (value) {
          return value;
        }
      }

      /*
       * Label on one line,
       * value on next line.
       */
      for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
        const candidate = lines[j];

        if (isAnyGroceryLabel(candidate)) {
          break;
        }

        if (candidate) {
          return candidate;
        }
      }
    }

    return null;
  }

  function extractGroceryAddress(lines, field, maxLines = 5) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      /*
       * Inline.
       */
      for (const regex of field.inline) {
        const match = line.match(regex);

        if (match) {
          const first = match[match.length - 1].trim();

          const rest = [];

          for (
            let j = i + 1;
            j < lines.length && rest.length < maxLines - 1;
            j++
          ) {
            const candidate = lines[j];

            if (isAnyGroceryLabel(candidate)) {
              break;
            }

            if (EMAIL_RE.test(candidate)) {
              break;
            }

            if (extractPhoneFromLine(candidate)) {
              break;
            }

            rest.push(candidate);
          }

          const value = [first, ...rest].join(", ");

          if (isPlausibleAddress(value)) {
            return normalizeDestinationAddress(value);
          }
        }
      }

      /*
       * Header.
       */
      const isHeader = field.header.some((regex) => regex.test(line));

      if (!isHeader) {
        continue;
      }

      const rest = [];

      for (let j = i + 1; j < lines.length && rest.length < maxLines; j++) {
        const candidate = lines[j];

        if (isAnyGroceryLabel(candidate)) {
          break;
        }

        if (EMAIL_RE.test(candidate)) {
          break;
        }

        if (extractPhoneFromLine(candidate)) {
          break;
        }

        rest.push(candidate);
      }

      const value = rest.join(", ");

      if (isPlausibleAddress(value)) {
        return normalizeDestinationAddress(value);
      }
    }

    return null;
  }

  /* ========================================================================
     GROCERY - SECTION BLOCKS
     ======================================================================== */

  const CUSTOMER_HEADER_RE = /^customer(\s+(details|information))?\s*:?\s*$/i;

  const VENDOR_HEADER_RE =
    /^(vendor(\s+details)?|store(\s+name)?|supermarket|retailer|supplier)\s*:?\s*$/i;

  function findBlockEnd(lines, startIndex) {
    for (let i = startIndex + 1; i < lines.length; i++) {
      if (isSectionHeader(lines[i])) {
        return i;
      }
    }

    return lines.length;
  }

  function findUnlabelledAddress(lines) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (!/^\d+[A-Za-z]?(?:\/\d+)?\s+/.test(line)) {
        continue;
      }

      if (!STREET_WORDS.test(line)) {
        continue;
      }

      const values = [line];

      for (let j = i + 1; j < lines.length && values.length < 4; j++) {
        const next = lines[j];

        if (isAnyGroceryLabel(next)) {
          break;
        }

        if (extractPhoneFromLine(next)) {
          break;
        }

        values.push(next);
      }

      const address = values.join(", ");

      if (isPlausibleAddress(address)) {
        return normalizeDestinationAddress(address);
      }
    }

    return null;
  }

  const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

  /* ========================================================================
     GROCERY - ORDER NUMBER
     ======================================================================== */

  function findGroceryOrderNumber(lines) {
    /*
     * Use same robust logic as Liquor,
     * but do NOT use Liquor layout assumptions.
     */
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      const match = line.match(
        /order\s*(?:#|no\.?|number|id)\s*:?\s*([A-Za-z0-9-]*\d{3,})/i,
      );

      if (match) {
        const value = cleanOrderNumber(match[1]);

        if (value) {
          return value;
        }
      }
    }

    /*
     * Split-label fallback.
     */
    for (let i = 0; i < lines.length; i++) {
      if (/^order\s*(?:#|no\.?|number|id)\s*:?\s*$/i.test(lines[i])) {
        for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
          const value = cleanOrderNumber(lines[j]);

          if (value) {
            return value;
          }
        }
      }
    }

    return null;
  }

  /* ========================================================================
     GROCERY - MAIN PARSER
     ======================================================================== */

  function extractGroceryOrder(lines) {
    const customerIndex = lines.findIndex((line) =>
      CUSTOMER_HEADER_RE.test(line),
    );

    const vendorIndex = lines.findIndex((line) => VENDOR_HEADER_RE.test(line));

    const customerBlock =
      customerIndex >= 0
        ? lines.slice(customerIndex, findBlockEnd(lines, customerIndex))
        : lines;

    const vendorBlock =
      vendorIndex >= 0
        ? lines.slice(vendorIndex, findBlockEnd(lines, vendorIndex))
        : [];

    let name = extractGroceryValue(customerBlock, GROCERY_LABELS.name);

    if (!name) {
      name = extractGroceryValue(lines, GROCERY_LABELS.name);
    }

    let mobile = extractGroceryValue(customerBlock, GROCERY_LABELS.mobile);

    if (!mobile) {
      mobile = extractGroceryValue(lines, GROCERY_LABELS.mobile);
    }

    /*
     * Normalize phone for both modes.
     */
    if (mobile) {
      mobile = cleanPhone(mobile);
    }

    let email = extractGroceryValue(customerBlock, GROCERY_LABELS.email);

    if (!email) {
      email = extractGroceryValue(lines, GROCERY_LABELS.email);
    }

    if (!email) {
      const match = lines.join(" ").match(EMAIL_RE);

      email = match ? match[0] : null;
    }

    let customerAddress = extractGroceryAddress(
      customerBlock,
      GROCERY_LABELS.address,
      5,
    );

    if (!customerAddress) {
      customerAddress = extractGroceryAddress(
        lines,
        WIDE_GROCERY_LABELS.destinationAddress,
        5,
      );
    }

    if (!customerAddress) {
      customerAddress = findUnlabelledAddress(lines);
    }

    /*
     * Vendor / pickup.
     */
    let vendorName = extractGroceryValue(vendorBlock, GROCERY_LABELS.name);

    if (!vendorName) {
      vendorName = extractGroceryValue(vendorBlock, {
        header: [/^store\s*(name)?\s*:?\s*$/i, /^vendor\s*(name)?\s*:?\s*$/i],

        inline: [
          /^store\s*(name)?\s*:?\s+(.+)$/i,
          /^vendor\s*(name)?\s*:?\s+(.+)$/i,
        ],
      });
    }

    let vendorAddress = extractGroceryAddress(
      vendorBlock,
      GROCERY_LABELS.address,
      5,
    );

    if (!vendorAddress) {
      vendorAddress = extractGroceryAddress(
        lines,
        WIDE_GROCERY_LABELS.pickupAddress,
        5,
      );
    }

    /*
     * General fields.
     */
    let orderNo = findGroceryOrderNumber(lines);

    let distanceRaw = extractGroceryValue(lines, GROCERY_LABELS.distance);

    let deliveryType = extractGroceryValue(lines, GROCERY_LABELS.deliveryType);

    let deliveryDate = extractGroceryValue(lines, GROCERY_LABELS.deliveryDate);

    let deliveryTime = extractGroceryValue(lines, GROCERY_LABELS.deliveryTime);

    let allowSubstitute = extractGroceryValue(
      lines,
      GROCERY_LABELS.allowSubstitute,
    );

    let orderInstructions = extractGroceryValue(
      lines,
      GROCERY_LABELS.orderInstructions,
    );

    let orderSize = extractGroceryValue(lines, GROCERY_LABELS.orderSize);

    let comment = extractGroceryValue(lines, GROCERY_LABELS.comment);

    /*
     * Final cleanup.
     */
    if (orderNo) {
      orderNo = cleanOrderNumber(orderNo);
    }

    if (customerAddress) {
      customerAddress = normalizeDestinationAddress(customerAddress);
    }

    if (vendorAddress) {
      vendorAddress = normalizeDestinationAddress(vendorAddress);
    }

    /*
     * Address ambiguity check.
     */
    let addressAmbiguous = false;

    if (!customerAddress && !vendorAddress) {
      addressAmbiguous = true;
    }

    if (
      customerAddress &&
      vendorAddress &&
      customerAddress.toLowerCase() === vendorAddress.toLowerCase()
    ) {
      addressAmbiguous = true;
    }

    return {
      raw: {
        name,
        email,
        mobile,
        customerAddress,
        vendorName,
        vendorAddress,
        orderNo,
        distanceRaw,
        deliveryType,
        deliveryDate,
        deliveryTime,
        allowSubstitute,
        orderInstructions,
        orderSize,
        comment,
        items: [],
      },

      orderType: "GROCERY",

      ocrOrderType: "GROCERY",

      addressAmbiguous,
    };
  }

  /* ========================================================================
     MAIN PARSER
     ======================================================================== */

  function parseOrder(rawText, fileExt, orderType) {
    const lines = cleanLines(rawText);

    /*
     * HARD SEPARATION.
     *
     * LIQUOR NEVER goes through Grocery parser.
     * GROCERY NEVER goes through Liquor parser.
     */
    if (orderType === "liquor") {
      const result = extractLiquorOrder(lines);

      result.orderType = "LIQUOR";

      return result;
    }

    const result = extractGroceryOrder(lines);

    result.orderType = "GROCERY";

    return result;
  }

  /* ========================================================================
     DISPLAY FORMATTING
     ======================================================================== */

  function formatItems(items) {
    if (!items || !items.length) {
      return "";
    }

    return items.map((item) => `${item.name} x ${item.qty}`).join("\n");
  }

  function buildDisplayFields(parsed) {
    const raw = parsed.raw;

    return {
      name: required(raw.name),

      email: required(raw.email),

      mobile: required(raw.mobile),

      /*
       * DISPLAY FULL ORDER NUMBER.
       */
      orderNo: required(raw.orderNo),

      orderType: parsed.orderType || NOT_FOUND,

      orderSize: optional(raw.orderSize),

      comment: optional(raw.comment),

      deliveryType: optional(raw.deliveryType),

      deliveryDate: optional(raw.deliveryDate),

      deliveryTime: optional(raw.deliveryTime),

      allowSubstitute: optional(raw.allowSubstitute),

      orderInstructions: optional(raw.orderInstructions),

      pickupAddress: raw.vendorAddress
        ? normalizeDestinationAddress(raw.vendorAddress)
        : NOT_FOUND,

      /*
       * NEW ZEALAND is ALWAYS removed here.
       * This is the final safety layer.
       */
      destinationAddress: required(
        normalizeDestinationAddress(raw.customerAddress),
      ),

      items: formatItems(raw.items),

      distance: raw.distanceRaw ? upper(raw.distanceRaw) : "NEEDS VERIFICATION",

      distanceState: raw.distanceRaw ? "source" : "failed",
    };
  }

  /* ========================================================================
     COPY TEXT
     ======================================================================== */

  function buildCopyText(fields) {
    /*
     * IMPORTANT:
     *
     * Order number in Copy All is NUMERIC ONLY.
     *
     * ORD-1049560280
     * ->
     * 1049560280
     */
    const copyOrder = orderNumberForCopy(fields.orderNo);

    const line = (label, value) => `${label}:\n${value || ""}`;

    const parts = [
      "CUSTOMER DETAILS",
      "",

      line("NAME", fields.name),
      "",

      line("EMAIL", fields.email),
      "",

      line("PHONE", fields.mobile),
      "",
      "",

      "ORDER DETAILS",
      "",

      line("ORDER NO", copyOrder),
      "",

      line("ORDER TYPE", fields.orderType),
      "",

      line("ORDER SIZE", fields.orderSize),
      "",

      line("COMMENT", fields.comment),
      "",
      "",

      "ADDITIONAL DETAILS",
      "",

      line("DELIVERY TYPE", fields.deliveryType),
      "",

      line("DELIVERY DATE", fields.deliveryDate),
      "",

      line("DELIVERY TIME", fields.deliveryTime),
      "",

      line("ALLOW SUBSTITUTE", fields.allowSubstitute),
      "",

      line("ORDER INSTRUCTIONS", fields.orderInstructions),
      "",
      "",

      line("PICKUP ADDRESS", fields.pickupAddress),
      "",
      "",

      line("DESTINATION ADDRESS", fields.destinationAddress),
      "",
      "",

      line("DISTANCE", fields.distance),
    ];

    if (fields.items) {
      parts.push("", "", line("ITEMS", fields.items));
    }

    return parts.join("\n");
  }

  /* ========================================================================
     RENDER
     ======================================================================== */

  function fieldRow(label, value, options = {}) {
    const row = document.createElement("div");

    row.className = "field-row";

    const main = document.createElement("div");

    main.className = "field-main";

    const labelEl = document.createElement("div");

    labelEl.className = "field-label";

    labelEl.textContent = label;

    const valueEl = document.createElement("div");

    let className = "field-value";

    if (value === NOT_FOUND) {
      className += " not-found";
    }

    if (options.pending) {
      className += " pending";
    }

    if (options.verified) {
      className += " verified";
    }

    valueEl.className = className;

    valueEl.textContent = value || "";

    valueEl.dataset.field = options.fieldKey || "";

    main.appendChild(labelEl);

    main.appendChild(valueEl);

    row.appendChild(main);

    if (options.copyable !== false) {
      const copyButton = document.createElement("button");

      copyButton.type = "button";

      copyButton.className = "btn-copy";

      copyButton.textContent = "Copy";

      copyButton.addEventListener("click", () => {
        let text = valueEl.textContent;

        /*
         * ORDER NUMBER COPY RULE.
         */
        if (options.fieldKey === "orderNo") {
          text = orderNumberForCopy(text);
        }

        copyToClipboard(text);
      });

      row.appendChild(copyButton);
    }

    return row;
  }

  function groupBlock(title, rows) {
    const block = document.createElement("div");

    block.className = "field-group";

    const titleEl = document.createElement("div");

    titleEl.className = "field-group-title";

    titleEl.textContent = title;

    block.appendChild(titleEl);

    rows.forEach((row) => block.appendChild(row));

    return block;
  }

  function renderResult(fields) {
    if (!resultCard) {
      return;
    }

    resultCard.innerHTML = "";

    resultCard.appendChild(
      groupBlock("Customer details", [
        fieldRow("Name", fields.name, {
          fieldKey: "name",
        }),

        fieldRow("Email", fields.email, {
          fieldKey: "email",
        }),

        fieldRow("Phone", fields.mobile, {
          fieldKey: "mobile",
        }),
      ]),
    );

    resultCard.appendChild(
      groupBlock("Order details", [
        fieldRow("Order no", fields.orderNo, {
          fieldKey: "orderNo",
        }),

        fieldRow("Order type", fields.orderType, {
          fieldKey: "orderType",
        }),

        fieldRow("Order size", fields.orderSize, {
          fieldKey: "orderSize",
        }),

        fieldRow("Comment", fields.comment, {
          fieldKey: "comment",
        }),
      ]),
    );

    resultCard.appendChild(
      groupBlock("Additional details", [
        fieldRow("Delivery type", fields.deliveryType, {
          copyable: false,
        }),

        fieldRow("Delivery date", fields.deliveryDate, {
          copyable: false,
        }),

        fieldRow("Delivery time", fields.deliveryTime, {
          copyable: false,
        }),

        fieldRow("Allow substitute", fields.allowSubstitute, {
          copyable: false,
        }),

        fieldRow("Order instructions", fields.orderInstructions, {
          copyable: false,
        }),
      ]),
    );

    resultCard.appendChild(
      groupBlock("Pickup address", [
        fieldRow("Store / vendor", fields.pickupAddress, {
          fieldKey: "pickupAddress",
        }),
      ]),
    );

    resultCard.appendChild(
      groupBlock("Destination address", [
        fieldRow("Customer", fields.destinationAddress, {
          fieldKey: "destinationAddress",
        }),
      ]),
    );

    if (fields.items) {
      resultCard.appendChild(
        groupBlock("Items", [
          fieldRow("Items to be delivered", fields.items, {
            fieldKey: "items",
          }),
        ]),
      );
    }

    const distanceOptions = {
      fieldKey: "distance",
    };

    if (fields.distanceState === "pending") {
      distanceOptions.pending = true;
    }

    if (fields.distanceState === "source") {
      distanceOptions.verified = true;
    }

    resultCard.appendChild(
      groupBlock("Distance", [
        fieldRow("Route", fields.distance, distanceOptions),
      ]),
    );

    if (resultScreen) {
      resultScreen.classList.remove("hidden");
    }
  }

  /* ========================================================================
     VALIDATION
     ======================================================================== */

  function renderValidation(parsed) {
    if (!validationBox) {
      return;
    }

    validationBox.innerHTML = "";

    validationBox.classList.remove("hidden");

    const checks = [
      {
        label: "Customer",
        ok: !!parsed.raw.name,
      },

      {
        label: "Order",
        ok: !!parsed.raw.orderNo,
      },

      {
        label: "Pickup",
        ok: !!parsed.raw.vendorAddress,
      },

      {
        label: "Destination",
        ok: !!parsed.raw.customerAddress,
      },

      {
        label: "Phone",
        ok: !!parsed.raw.mobile,
      },
    ];

    checks.forEach((check) => {
      const pill = document.createElement("span");

      pill.className = "pill " + (check.ok ? "ok" : "warn");

      pill.textContent = (check.ok ? "✓ " : "⚠ ") + check.label;

      validationBox.appendChild(pill);
    });

    if (parsed.addressAmbiguous) {
      const pill = document.createElement("span");

      pill.className = "pill warn";

      pill.textContent = "⚠ Address mapping needs review";

      validationBox.appendChild(pill);
    }
  }

  /* ========================================================================
     DEBUG PANEL
     ======================================================================== */

  let debugPanel = null;
  let debugBody = null;

  function createDebugPanel() {
    if (debugPanel) {
      return;
    }

    debugPanel = document.createElement("div");

    debugPanel.className = "card debug-panel";

    debugPanel.style.cssText = "padding:14px 16px;";

    const toggle = document.createElement("button");

    toggle.type = "button";

    toggle.className = "btn-link";

    toggle.textContent = "Show debug info";

    toggle.setAttribute("aria-expanded", "false");

    debugBody = document.createElement("pre");

    debugBody.style.cssText =
      "display:none;margin-top:10px;background:#f0f1f2;border-radius:8px;padding:12px;font-family:monospace;font-size:12px;line-height:1.5;white-space:pre-wrap;word-break:break-word;max-height:320px;overflow-y:auto;";

    toggle.addEventListener("click", () => {
      const hidden = debugBody.style.display === "none";

      debugBody.style.display = hidden ? "block" : "none";

      toggle.textContent = hidden ? "Hide debug info" : "Show debug info";

      toggle.setAttribute("aria-expanded", String(hidden));
    });

    debugPanel.appendChild(toggle);

    debugPanel.appendChild(debugBody);

    if (resultCard) {
      resultCard.insertAdjacentElement("afterend", debugPanel);
    }
  }

  function renderDebug(parsed, extraction, ext, lines) {
    createDebugPanel();

    if (!debugBody) {
      return;
    }

    const output = [];

    output.push(`MODE: ${selectedOrderType}`);

    output.push(`FILE TYPE: ${ext.toUpperCase()}`);

    output.push(`METHOD: ${extraction.method}`);

    if (extraction.debug) {
      output.push(`PSM: ${extraction.debug.pageSegMode || TESSERACT_PSM}`);

      if (extraction.debug.pagesProcessed != null) {
        output.push(`PAGES: ${extraction.debug.pagesProcessed}`);
      }

      if (extraction.debug.nativeTextPages != null) {
        output.push(`NATIVE PDF PAGES: ${extraction.debug.nativeTextPages}`);
      }

      if (extraction.debug.ocrPages != null) {
        output.push(`OCR PDF PAGES: ${extraction.debug.ocrPages}`);
      }

      if (extraction.debug.totalExtractionMs != null) {
        output.push(`TIME: ${extraction.debug.totalExtractionMs} ms`);
      }
    }

    output.push("");

    output.push("PARSED FIELDS:");

    output.push(JSON.stringify(parsed.raw, null, 2));

    output.push("");

    output.push("CLEANED OCR:");

    output.push(lines.map((line, index) => `${index}: ${line}`).join("\n"));

    debugBody.textContent = output.join("\n");
  }

  function hideDebugPanel() {
    if (debugPanel) {
      debugPanel.remove();
    }

    debugPanel = null;
    debugBody = null;
  }

  /* ========================================================================
     CLIPBOARD
     ======================================================================== */

  function showToast(message) {
    if (!toast) {
      return;
    }

    toast.textContent = message;

    toast.classList.remove("hidden");

    clearTimeout(showToast.timer);

    showToast.timer = setTimeout(() => {
      toast.classList.add("hidden");
    }, 1600);
  }

  async function copyToClipboard(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text || "");
      } else {
        const textarea = document.createElement("textarea");

        textarea.value = text || "";

        textarea.style.position = "fixed";

        textarea.style.opacity = "0";

        document.body.appendChild(textarea);

        textarea.select();

        document.execCommand("copy");

        textarea.remove();
      }

      showToast("✓ Copied");
    } catch (error) {
      showToast("Copy failed");
    }
  }

  /* ========================================================================
     MAIN EXTRACTION
     ======================================================================== */

  if (extractBtn) {
    extractBtn.addEventListener("click", async () => {
      if (!selectedFile) {
        return;
      }

      if (!selectedOrderType) {
        showFileError("Select Grocery or Liquor first.");

        return;
      }

      extractBtn.disabled = true;

      clearFileError();

      if (validationBox) {
        validationBox.classList.add("hidden");
      }

      if (resultScreen) {
        resultScreen.classList.add("hidden");
      }

      hideDebugPanel();

      const ext = extOf(selectedFile.name);

      const started = performance.now();

      try {
        setStatus(
          selectedOrderType === "liquor"
            ? "Reading liquor order..."
            : "Reading grocery order...",
        );

        let extraction;

        if (ext === "pdf") {
          extraction = await extractFromPdf(selectedFile);
        } else {
          extraction = await extractFromImage(selectedFile);
        }

        setStatus("Formatting result...");

        const rawText = extraction.text || "";

        extraction.debug = extraction.debug || {};

        extraction.debug.totalExtractionMs = Math.round(
          performance.now() - started,
        );

        state.rawText = rawText;

        if (rawOcrText) {
          rawOcrText.textContent = rawText.trim() || "(No text detected)";
        }

        /*
         * HARD MODE SEPARATION.
         */
        const parsed = parseOrder(rawText, ext, selectedOrderType);

        const fields = buildDisplayFields(parsed);

        state.fields = fields;

        state.orderType = parsed.orderType;

        hideStatus();

        renderValidation(parsed);

        renderResult(fields);

        renderDebug(parsed, extraction, ext, cleanLines(rawText));

        showModeIndicator(selectedOrderType);

        if (resultScreen) {
          resultScreen.scrollIntoView({
            block: "start",
            behavior: "smooth",
          });
        }
      } catch (error) {
        hideStatus();

        console.error("OCR extraction error:", error);

        showFileError(
          "Could not extract this order: " +
            (error && error.message ? error.message : String(error)),
        );
      } finally {
        extractBtn.disabled = false;
      }
    });
  }

  /* ========================================================================
     COPY ALL
     ======================================================================== */

  if (copyAllBtn) {
    copyAllBtn.addEventListener("click", () => {
      if (!state.fields) {
        return;
      }

      copyToClipboard(buildCopyText(state.fields));
    });
  }

  /* ========================================================================
     RAW OCR
     ======================================================================== */

  if (toggleRawBtn && rawOcrBody) {
    toggleRawBtn.addEventListener("click", () => {
      const hidden = rawOcrBody.classList.contains("hidden");

      rawOcrBody.classList.toggle("hidden");

      toggleRawBtn.setAttribute("aria-expanded", String(hidden));

      toggleRawBtn.textContent = hidden
        ? "Hide raw OCR text"
        : "Show raw OCR text";
    });
  }

  if (copyRawBtn) {
    copyRawBtn.addEventListener("click", () => {
      copyToClipboard(state.rawText || "");
    });
  }

  /* ========================================================================
     RESET
     ======================================================================== */

  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      selectedFile = null;

      selectedOrderType = null;

      state = {
        fields: null,
        rawText: "",
        orderType: "",
      };

      if (fileInput) {
        fileInput.value = "";
      }

      if (fileInfo) {
        fileInfo.classList.add("hidden");
      }

      if (extractBtn) {
        extractBtn.classList.add("hidden");
      }

      if (validationBox) {
        validationBox.classList.add("hidden");
      }

      if (resultScreen) {
        resultScreen.classList.add("hidden");
      }

      if (rawOcrBody) {
        rawOcrBody.classList.add("hidden");
      }

      if (toggleRawBtn) {
        toggleRawBtn.textContent = "Show raw OCR text";

        toggleRawBtn.setAttribute("aria-expanded", "false");
      }

      clearFileError();

      hideStatus();

      hideDebugPanel();

      goToOrderTypeScreen();

      window.scrollTo({
        top: 0,
        behavior: "smooth",
      });
    });
  }

  /* ========================================================================
     CLEANUP
     ======================================================================== */

  window.addEventListener("pagehide", () => {
    void disposeOcrWorker();
  });

  /* ========================================================================
     TESTING API
     ======================================================================== */

  if (typeof window !== "undefined") {
    window.__ocrExtractorInternals = {
      cleanLines,
      parseOrder,
      buildDisplayFields,

      /*
       * Useful for directly testing the exact problematic cases.
       */
      cleanOrderNumber,
      orderNumberForCopy,
      cleanPhone,
      normalizeDestinationAddress,

      findLiquorOrderNumber,
      findCustomerNameAndPhone,
      extractLiquorOrder,
      extractGroceryOrder,
    };
  }

  /* ========================================================================
     START
     ======================================================================== */

  /*
   * If the page already has the order type screen,
   * make sure upload screen starts hidden.
   */
  if (orderTypeScreen && uploadScreen) {
    uploadScreen.classList.add("hidden");
  }
})();
