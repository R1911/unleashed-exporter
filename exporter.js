const axios = require("axios");
const https = require("https");
const express = require("express");
const { XMLParser } = require("fast-xml-parser");
const client_prometheus = require("prom-client");
const pkg = require("./package.json");
const { performance } = require("perf_hooks");

const PORT = 9105;
const SHUTDOWN_TIMEOUT = 10000;

const sessionCache = new Map();
const airtimeHistory = new Map();
const lastAirtimeState = new Map();

const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  magenta: "\x1b[35m",
  red: "\x1b[31m",
  dim: "\x1b[2m",
};
const getFormattedDate = () => {
  const now = new Date();
  const d = String(now.getDate()).padStart(2, "0");
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const y = now.getFullYear();
  const h = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");
  const s = String(now.getSeconds()).padStart(2, "0");
  const ms = String(now.getMilliseconds()).padStart(3, "0");

  return `${d}-${m}-${y} ${h}:${min}:${s}:${ms}`;
};

const logger = {
  getTimestamp: () => `${colors.dim}[${getFormattedDate()}]${colors.reset}`,
  info: (msg) =>
    console.log(
      `${logger.getTimestamp()} ${colors.cyan}INFO${colors.reset}: ${msg}`,
    ),
  success: (msg) =>
    console.log(
      `${logger.getTimestamp()} ${colors.green}SUCCESS${colors.reset}: ${msg}`,
    ),
  warn: (msg) =>
    console.warn(
      `${logger.getTimestamp()} ${colors.yellow}WARN${colors.reset}: ${msg}`,
    ),
  error: (msg, err = "") =>
    console.error(
      `${logger.getTimestamp()} ${colors.red}ERROR${colors.reset}: ${msg}`,
      err,
    ),
};

const app = express();
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  parseTagValue: true,
});

/**
 * Metric Definitions
 */
function createRegistry(master) {
  const register = new client_prometheus.Registry();
  const defaultLabels = { master };
  register.setDefaultLabels(defaultLabels);

  return {
    register,
    scrapeSuccess: new client_prometheus.Gauge({
      name: "ruckus_exporter_last_scrape_success",
      help: "1 if successful",
      registers: [register],
    }),
    scrapeDuration: new client_prometheus.Summary({
      name: "ruckus_exporter_scrape_duration_seconds",
      help: "Duration per module",
      labelNames: ["module"],
      registers: [register],
    }),
    longestModule: new client_prometheus.Gauge({
      name: "ruckus_exporter_slowest_module_duration_seconds",
      help: "Slowest module duration",
      labelNames: ["module_name"],
      registers: [register],
    }),
    totalClients: new client_prometheus.Gauge({
      name: "ruckus_unleashed_network_clients_total",
      help: "Total wireless stations",
      registers: [register],
    }),
    totalAps: new client_prometheus.Gauge({
      name: "ruckus_unleashed_network_aps_total",
      help: "Total APs",
      registers: [register],
    }),
    totalRxBytes: new client_prometheus.Gauge({
      name: "ruckus_unleashed_network_rx_bytes_total",
      help: "Total RX",
      registers: [register],
    }),
    totalTxBytes: new client_prometheus.Gauge({
      name: "ruckus_unleashed_network_tx_bytes_total",
      help: "Total TX",
      registers: [register],
    }),
    apRoleCount: new client_prometheus.Gauge({
      name: "ruckus_unleashed_ap_role_count",
      help: "Master vs Member count",
      labelNames: ["role"],
      registers: [register],
    }),
    apNoiseFloor: new client_prometheus.Gauge({
      name: "ruckus_unleashed_ap_noise_floor_dbm",
      help: "Radio interference level",
      labelNames: ["name", "mac", "model", "radio"],
      registers: [register],
    }),
    apAirtime: new client_prometheus.Gauge({
      name: "ruckus_unleashed_ap_airtime_utilization_percent",
      help: "Airtime utilization %",
      labelNames: ["name", "mac", "model", "radio"],
      registers: [register],
    }),
    controllerCpu: new client_prometheus.Gauge({
      name: "ruckus_unleashed_controller_cpu_usage_percent",
      help: "Master CPU %",
      registers: [register],
    }),
    controllerMem: new client_prometheus.Gauge({
      name: "ruckus_unleashed_controller_memory_usage_percent",
      help: "Master RAM %",
      registers: [register],
    }),
    controllerUptime: new client_prometheus.Gauge({
      name: "ruckus_unleashed_controller_uptime_seconds",
      help: "Master Uptime",
      registers: [register],
    }),
    apStatus: new client_prometheus.Gauge({
      name: "ruckus_unleashed_ap_status",
      help: "1=Online, 0=Offline",
      labelNames: ["name", "mac", "model", "ip", "fw", "role"],
      registers: [register],
    }),
    apUptime: new client_prometheus.Gauge({
      name: "ruckus_unleashed_ap_uptime_seconds",
      help: "AP Uptime",
      labelNames: ["name", "mac", "model"],
      registers: [register],
    }),
    apClients: new client_prometheus.Gauge({
      name: "ruckus_unleashed_ap_clients",
      help: "Clients per AP",
      labelNames: ["name", "mac", "model"],
      registers: [register],
    }),
    apRxBytes: new client_prometheus.Gauge({
      name: "ruckus_unleashed_ap_rx_bytes_total",
      help: "RX per AP",
      labelNames: ["name", "mac", "model"],
      registers: [register],
    }),
    apTxBytes: new client_prometheus.Gauge({
      name: "ruckus_unleashed_ap_tx_bytes_total",
      help: "TX per AP",
      labelNames: ["name", "mac", "model"],
      registers: [register],
    }),
    apCpu: new client_prometheus.Gauge({
      name: "ruckus_unleashed_ap_cpu_utilization",
      help: "CPU per AP",
      labelNames: ["name", "mac", "model"],
      registers: [register],
    }),
    apMemUsage: new client_prometheus.Gauge({
      name: "ruckus_unleashed_ap_memory_usage_percent",
      help: "RAM per AP",
      labelNames: ["name", "mac", "model"],
      registers: [register],
    }),
    apClientSignalQuality: new client_prometheus.Gauge({
      name: "ruckus_unleashed_ap_client_signal_quality_count",
      help: "RSSI breakdown",
      labelNames: ["name", "mac", "radio", "quality"],
      registers: [register],
    }),
  };
}

async function ruckusLogin(target, user, pass, metrics) {
  const start = performance.now();
  const client = axios.create({
    baseURL: `https://${target}`,
    httpsAgent: new https.Agent({ rejectUnauthorized: false }),
    timeout: 10000,
  });

  try {
    logger.info(`Auth required for ${target}. Logging in as ${user}...`);
    const initRes = await client.get("/admin/login.jsp");
    let authCookies =
      initRes.headers["set-cookie"]?.map((c) => c.split(";")[0]).join("; ") ||
      "";

    const params = new URLSearchParams({
      username: user,
      password: pass,
      ok: "Log in",
      action: "login.jsp",
    });
    const loginRes = await client.post("/admin/login.jsp", params.toString(), {
      headers: {
        Cookie: authCookies,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      maxRedirects: 0,
      validateStatus: (s) => s < 400,
    });

    if (loginRes.headers["set-cookie"]) {
      authCookies = loginRes.headers["set-cookie"]
        .map((c) => c.split(";")[0])
        .join("; ");
    }

    const csrfRes = await client.get("/admin/_csrfTokenVar.jsp", {
      headers: { Cookie: authCookies },
    });
    const match = csrfRes.data.match(/cs[f|r]{2}Token\s*=\s*['"]([^'"]*)['"]/i);

    if (!match) throw new Error("CSRF missing");

    const session = { csrfToken: match[1], authCookies };
    sessionCache.set(target, session);

    metrics.scrapeDuration.observe(
      { module: "login" },
      (performance.now() - start) / 1000,
    );
    return session;
  } catch (e) {
    logger.error(`Login failed for ${target}: ${e.message}`);
    return null;
  }
}

app.get("/probe", async (req, res) => {
  const target = req.query.target;
  const authHeader = req.headers.authorization || "";

  if (!target || !authHeader.startsWith("Basic ")) {
    res.setHeader("WWW-Authenticate", 'Basic realm="Ruckus Exporter"');
    return res.status(401).send("Target param and Basic Auth required");
  }

  const [user, pass] = Buffer.from(authHeader.split(" ")[1], "base64")
    .toString()
    .split(":");
  const m = createRegistry(target);
  const totalStart = performance.now();
  let moduleTimings = {};

  let session = sessionCache.get(target);
  if (!session) {
    session = await ruckusLogin(target, user, pass, m);
    if (!session) {
      m.scrapeSuccess.set(0);
      return res.status(401).end(await m.register.metrics());
    }
  }

  const client = axios.create({
    baseURL: `https://${target}`,
    httpsAgent: new https.Agent({ rejectUnauthorized: false }),
    timeout: 15000,
  });

  const headers = {
    Cookie: session.authCookies,
    "X-CSRF-Token": session.csrfToken,
    "Content-Type": "text/xml",
  };

  try {
    const apiStart = performance.now();
    const [invR, statR, clientR] = await Promise.all([
      client.post(
        "/admin/_cmdstat.jsp",
        `<ajax-request action='getstat' comp='apmgr'><ap-list /></ajax-request>`,
        { headers },
      ),
      client.post(
        "/admin/_cmdstat.jsp",
        `<ajax-request action='getstat' comp='stamgr'><ap /></ajax-request>`,
        { headers },
      ),
      client.post(
        "/admin/_cmdstat.jsp",
        `<ajax-request action='getstat' comp='stamgr'><client /></ajax-request>`,
        { headers },
      ),
    ]);

    if (invR.data.includes("login.jsp")) {
      sessionCache.delete(target);
      throw new Error("Session expired");
    }

    moduleTimings["api_requests"] = (performance.now() - apiStart) / 1000;
    m.scrapeDuration.observe(
      { module: "api_requests" },
      moduleTimings["api_requests"],
    );

    const parseStart = performance.now();
    const invJson = parser.parse(invR.data);
    const statJson = parser.parse(statR.data);
    const clientJson = parser.parse(clientR.data);

    const findAll = (obj, key) => {
      let results = [];
      const recursiveSearch = (current) => {
        if (!current || typeof current !== "object") return;
        if (current[key]) {
          const items = Array.isArray(current[key])
            ? current[key]
            : [current[key]];
          results.push(...items);
        }
        Object.values(current).forEach((val) => recursiveSearch(val));
      };
      recursiveSearch(obj);
      return results;
    };

    const clean = (v) =>
      v ? parseFloat(v.toString().replace(/[^0-9.-]/g, "")) : 0;

    const apMap = {};
    findAll(invJson, "ap").forEach((ap) => {
      const mac = String(ap.mac || ap["mac-address"] || "").toLowerCase();
      if (mac) {
        apMap[mac] = {
          name: ap["ap-name"] || ap["devname"] || ap["device-name"] || mac,
          model: ap.model || ap["display-model"] || "unknown",
        };
      }
    });

    const allClients = findAll(clientJson, "client");
    allClients.forEach((c) => {
      const apMac = String(c.ap || "").toLowerCase();
      const meta = apMap[apMac] || { name: c["ap-name"] || "Unknown-AP" };

      const rssi = clean(c.rssi || 0);
      const band = String(c["radio-band"] || "").includes("5") ? "5g" : "2.4g";

      if (rssi !== 0) {
        let quality = "poor";
        if (rssi < 0) {
          if (rssi >= -67) quality = "good";
          else if (rssi >= -75) quality = "moderate";
        } else {
          if (rssi >= 30) quality = "good";
          else if (rssi >= 20) quality = "moderate";
        }

        m.apClientSignalQuality.inc({
          name: String(meta.name),
          mac: apMac,
          radio: band,
          quality: quality,
        });
      }
    });

    let netClients = 0,
      netAps = 0,
      netRx = 0,
      netTx = 0,
      masterCount = 0,
      memberCount = 0;
    findAll(statJson, "ap").forEach((ap) => {
      const mac = ap.mac || ap["mac-address"];
      if (!mac) return;
      netAps++;
      const meta = apMap[mac] || {
        name: ap["ap-name"] || mac,
        model: (ap.model || "unknown").toUpperCase(),
      };
      const role = (ap.role || "member").toLowerCase();
      const labels = { name: meta.name, mac, model: meta.model };

      const uptime = parseInt(ap["uptime"] || ap["up-time"] || 0);
      const clients = parseInt(ap["num-sta"] || 0);
      const rx = clean(ap["lan_stats_rx_byte"] || ap["rx-byte"] || 0);
      const tx = clean(ap["lan_stats_tx_byte"] || ap["tx-byte"] || 0);
      const memFree = clean(ap["mem_avail"] || 0);
      const memTotal = clean(ap["mem_total"] || 0);
      netClients += clients;
      netRx += rx;
      netTx += tx;
      m.apUptime.set(labels, uptime);
      m.apRxBytes.set(labels, rx);
      m.apTxBytes.set(labels, tx);

      if (memTotal > 0) {
        m.apMemUsage.set(labels, ((memTotal - memFree) / memTotal) * 100);
      }

      if (role === "master") {
        masterCount++;
        m.controllerCpu.set(clean(ap["cpu_util"]));
        m.controllerUptime.set(uptime);
        if (ap["mem_total"])
          m.controllerMem.set(
            ((clean(ap["mem_total"]) - clean(ap["mem_avail"])) /
              clean(ap["mem_total"])) *
              100,
          );
      } else {
        memberCount++;
      }

      if (Array.isArray(ap.radio)) {
        ap.radio.forEach((r) => {
          const band =
            r["radio-band"] || (r["radio-id"] === "0" ? "2.4g" : "5g");
          const rLabels = { ...labels, radio: band };

          if (r.noisefloor) m.apNoiseFloor.set(rLabels, clean(r.noisefloor));

          if (r["airtime-total"] !== undefined) {
            const currentTicks = clean(r["airtime-total"]);
            const currentUptime = parseInt(ap.uptime || 0);
            const stateKey = `${mac}-${band}`;
            const lastState = lastAirtimeState[stateKey];

            if (
              lastState &&
              currentUptime > lastState.uptime &&
              currentTicks >= lastState.ticks
            ) {
              const deltaTicks = currentTicks - lastState.ticks;
              const deltaUptimeSeconds = currentUptime - lastState.uptime;
              let instantUtil = (deltaTicks / (deltaUptimeSeconds * 100)) * 100;

              if (!airtimeHistory[stateKey]) airtimeHistory[stateKey] = [];
              airtimeHistory[stateKey].push(instantUtil);
              if (airtimeHistory[stateKey].length > 3)
                airtimeHistory[stateKey].shift();

              const smoothedUtil =
                airtimeHistory[stateKey].reduce((a, b) => a + b) /
                airtimeHistory[stateKey].length;
              m.apAirtime.set(
                rLabels,
                Math.max(0, Math.min(100, smoothedUtil)),
              );
            }
            lastAirtimeState[stateKey] = {
              ticks: currentTicks,
              uptime: currentUptime,
            };
          }
        });
      }

      m.apStatus.set(
        { ...labels, ip: ap.ip, fw: ap["firmware-version"], role },
        ap.state == "1" || ap.status == "up" ? 1 : 0,
      );
      m.apClients.set(labels, clients);
      m.apCpu.set(labels, clean(ap["cpu_util"]));
    });

    m.totalClients.set(netClients);
    m.totalAps.set(netAps);
    m.apRoleCount.set({ role: "master" }, masterCount);
    m.apRoleCount.set({ role: "member" }, memberCount);
    m.totalRxBytes.set(netRx);
    m.totalTxBytes.set(netTx);

    moduleTimings["processing"] = (performance.now() - parseStart) / 1000;
    m.scrapeDuration.observe(
      { module: "processing" },
      moduleTimings["processing"],
    );
    m.scrapeSuccess.set(1);

    const slowest = Object.entries(moduleTimings).reduce((a, b) =>
      a[1] > b[1] ? a : b,
    );
    m.longestModule.set({ module_name: slowest[0] }, slowest[1]);
    const totalDuration = (performance.now() - totalStart) / 1000;
    m.scrapeDuration.observe({ module: "total" }, totalDuration);

    res.set("Content-Type", m.register.contentType);
    res.end(await m.register.metrics());
  } catch (err) {
    logger.error(`Scrape error for ${target}: ${err.message}`);
    m.scrapeSuccess.set(0);
    res.status(500).end(await m.register.metrics());
  }
});

const server = app.listen(PORT, () => {
  const startTime = getFormattedDate();
  const boxWidth = 75;

  console.log(
    colors.cyan +
      `
 ██╗   ██╗███╗   ██╗██╗     ███████╗ █████╗ ███████╗██╗  ██╗███████╗██████╗ 
 ██║   ██║████╗  ██║██║     ██╔════╝██╔══██╗██╔════╝██║  ██║██╔════╝██╔══██╗
 ██║   ██║██╔██╗ ██║██║     █████╗  ███████║███████╗███████║█████╗  ██║  ██║
 ██║   ██║██║╚██╗██║██║     ██╔══╝  ██╔══██║╚════██║██╔══██║██╔══╝  ██║  ██║
 ╚██████╔╝██║ ╚████║███████╗███████╗██║  ██║███████║██║  ██║███████╗██████╔╝
  ╚═════╝ ╚═╝  ╚═══╝╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝╚══════╝╚═════╝ ` +
      colors.reset,
  );

  console.log(
    colors.bright + " by R1911 (https://github.com/R1911)" + colors.reset,
  );
  const visualLength = (str) => str.replace(/\u001b\[\d+m/g, "").length;

  const printRow = (label, value) => {
    const leftColWidth = 15;
    const padding = " ".repeat(leftColWidth - label.length);
    const content = `${colors.bright}${label}:${colors.reset}${padding}${value}`;

    const currentVisualLength = visualLength(content);
    const fill = " ".repeat(Math.max(0, boxWidth - 4 - currentVisualLength));

    console.log(
      `${colors.dim} │ ${colors.reset}${content}${fill}${colors.dim} │${colors.reset}`,
    );
  };

  console.log(
    colors.dim + " ┌" + "─".repeat(boxWidth - 2) + "┐" + colors.reset,
  );

  printRow(
    "Exporter",
    `${colors.cyan}${pkg.description} v${pkg.version}${colors.reset}`,
  );
  printRow(
    "Runtime",
    `Node.js ${colors.yellow}${process.version}${colors.reset} (${process.arch})`,
  );
  printRow("Started", startTime);
  printRow(
    "Metrics",
    `${colors.green}http://localhost:${PORT}/probe${colors.reset}`,
  );
  printRow("Process ID", `${colors.dim}${process.pid}${colors.reset}`);
  printRow(
    "Status",
    `${colors.green}● ONLINE${colors.reset} (listening on port ${PORT})`,
  );

  console.log(
    colors.dim + " └" + "─".repeat(boxWidth - 2) + "┘" + colors.reset,
  );
});

const shutdown = () => {
  logger.warn("Received termination signal. Shutting down gracefully...");
  server.close(() => {
    logger.success("HTTP server closed.");
    process.exit(0);
  });

  setTimeout(() => {
    logger.error(
      `Could not close connections in time (>${SHUTDOWN_TIMEOUT / 1000}s), forcing shutdown.`,
    );
    process.exit(1);
  }, SHUTDOWN_TIMEOUT);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("unhandledRejection", (reason) =>
  logger.error("Unhandled Rejection:", reason),
);
