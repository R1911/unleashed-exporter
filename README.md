# Ruckus Unleashed Prometheus Exporter

<p align="left"> <img src="https://img.shields.io/badge/Version-0.0.2-blue?style=flat-square" alt="Version"> <img src="https://img.shields.io/badge/Runtime-Node.js_25-339933?style=flat-square&logo=node.js&logoColor=white" alt="Runtime"> <img src="https://img.shields.io/badge/Framework-Express-lightgrey?style=flat-square&logo=express" alt="Framework"> <img src="https://img.shields.io/badge/Metrics-Prometheus-E6522C?style=flat-square&logo=prometheus&logoColor=white" alt="Prometheus"> <img src="https://img.shields.io/badge/Container-Docker-2496ED?style=flat-square&logo=docker&logoColor=white" alt="Docker"> </p>

A Node.js service that scrapes metrics from Ruckus Unleashed wireless controllers and exposes them in a Prometheus-compatible format. It uses the Unleashed web API to gather real-time data on Access Points (APs), connected clients, and system performance.

---

## Capabilities

The exporter collects data across several categories:

### Infrastructure & Controller

- **System Health:** CPU and memory utilization of the Master AP (controller).
- **Uptime:** Controller and individual AP uptime tracked in seconds.
- **Inventory:** Total count of APs and their current roles (Master vs. Member).
- **Hardware Details:** Models, firmware versions, and IP addresses.

### Radio & Wireless

- **Airtime Utilization:** Calculated percentage of radio bandwidth in use (smoothed via a moving average to filter noise).
- **Noise Floor:** Interference levels measured in dBm per radio (2.4GHz and 5GHz).
- **Signal Quality:** Client RSSI categorized into quality buckets (Good, Moderate, Poor).

### Traffic & Clients

- **Data Volume:** Total RX and TX bytes for the entire network and per individual AP.
- **Client Density:** Active station counts per AP and across the whole site.
- **Traffic Analysis:** Monitoring of LAN-side statistics reported by the APs.

---

## Setup

### Requirements

- Node.js (v20 or newer recommended)
- A Ruckus Unleashed network with a reachable IP/Hostname
- Administrative credentials for the Unleashed web interface

### Installation

1. Clone the repository or copy the source files.
2. Install dependencies:

```bash
npm install --production

```

3. Start the exporter:

```bash
node exporter.js

```

The service defaults to port `9105`.

### Running with Docker

A multi-stage `Dockerfile` is provided for a small footprint:

```bash
docker build -t ruckus-exporter .
docker run -p 9105:9105 ruckus-exporter

```

---

## Prometheus Configuration

The exporter uses a "probe" pattern. This means you pass the target Unleashed IP as a URL parameter, allowing one exporter instance to monitor multiple controllers if needed.

Authentication is handled via **Basic Auth**, using your Unleashed web UI credentials.

### Example `prometheus.yml`

```yaml
scrape_configs:
  - job_name: "ruckus-unleashed"
    metrics_path: /probe
    params:
      target: ["192.168.1.1"] # Your Unleashed Master AP IP
    static_configs:
      - targets: ["localhost:9105"] # The exporter's address
    relabel_configs:
      - source_labels: [__address__]
        target_label: __param_target
      - source_labels: [__param_target]
        target_label: instance
      - target_label: __address__
        replacement: localhost:9105
    basic_auth:
      username: "your_admin_username"
      password: "your_admin_password"
```

---

## Technical Details

### Internal Logic

- **Session Management:** The exporter performs a login handshake to obtain a session cookie and CSRF token. These are cached in memory to avoid logging in for every scrape.
- **XML Parsing:** Data is fetched from the Unleashed `_cmdstat.jsp` endpoint in XML format and converted to JSON for processing.
- **Calculated Metrics:** \* **Airtime:** Since Unleashed provides raw "ticks," the exporter calculates the delta between scrapes to provide a percentage.
- **Signal Quality:** RSSI values are mapped to human-readable labels based on standard signal strength thresholds.

### Endpoint Reference

- `GET /probe?target=<IP>`: The primary metrics endpoint. Requires Basic Auth.
- **Port:** `9105` (configurable via `PORT` constant in code).

---

<p align="center">
  Maintained by <a href="https://github.com/R1911">R1911</a>
</p>