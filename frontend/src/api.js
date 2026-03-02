import axios from "axios";

const client = axios.create({
  baseURL: "/api",
  timeout: 120000,
});

function buildGetUrl(path, params = {}) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    search.append(key, String(value));
  });
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

export async function getHealth() {
  const { data } = await client.get("/health");
  return data;
}

export async function getDashboard(params) {
  const url = buildGetUrl("/rocket-league-dashboard", params);
  const { data } = await client.get(url, { timeout: 0 });
  return data;
}

export async function detectReplays(params) {
  const url = buildGetUrl("/rocket-league-detect", params);
  const { data } = await client.get(url);
  return data;
}

export async function getDashboardProgress(runId) {
  const url = buildGetUrl("/rocket-league-progress", { run_id: runId });
  const { data } = await client.get(url, { timeout: 30000 });
  return data;
}

export async function cancelDashboardRun(runId) {
  const url = buildGetUrl("/rocket-league-cancel", { run_id: runId });
  const { data } = await client.post(url);
  return data;
}

export async function pickBoxcarsExe() {
  const { data } = await client.post("/pick-boxcars-exe");
  return data?.path || "";
}

export async function pickDemosDir() {
  const { data } = await client.post("/pick-demos-dir");
  return data?.path || "";
}

export async function pickCacheDir() {
  const { data } = await client.post("/pick-cache-dir");
  return data?.path || "";
}

export async function pickRawDir() {
  const { data } = await client.post("/pick-raw-dir");
  return data?.path || "";
}

export async function clearCache(params = {}) {
  const url = buildGetUrl("/clear-cache", params);
  try {
    const { data } = await client.post(url);
    return data;
  } catch (err) {
    const status = err?.response?.status;
    if (status === 404 || status === 405) {
      const { data } = await client.get(url);
      return data;
    }
    throw err;
  }
}

export async function openCacheDir(params = {}) {
  const url = buildGetUrl("/open-cache-dir", params);
  try {
    const { data } = await client.post(url);
    return data;
  } catch (err) {
    const status = err?.response?.status;
    if (status === 404 || status === 405) {
      const { data } = await client.get(url);
      return data;
    }
    throw err;
  }
}

export async function openRawDir(params = {}) {
  const url = buildGetUrl("/open-raw-dir", params);
  try {
    const { data } = await client.post(url);
    return data;
  } catch (err) {
    const status = err?.response?.status;
    if (status === 404 || status === 405) {
      const { data } = await client.get(url);
      return data;
    }
    throw err;
  }
}
