// main.js

const { app, BrowserWindow, session } = require('electron');
const path = require('path');
const fs = require('fs');
const process = require('process');

const webReqLogFilePath = path.join(process.cwd(), 'web_requests.json');
const wsLogFilePath = path.join(process.cwd(), 'ws_req.json');
const baseDataDir = path.join(process.cwd(), 'web_datas');

function logHttpActivity(activityData) {
  let logs = [];
  try {
    if (fs.existsSync(webReqLogFilePath)) {
      const fileContent = fs.readFileSync(webReqLogFilePath, 'utf8');
      if (fileContent) {
        logs = JSON.parse(fileContent);
        if (!Array.isArray(logs)) {
          console.error("web_requests.json was not an array. Resetting.");
          logs = [];
        }
      } else {
        logs = [];
      }
    } else {
      logs = [];
    }
  } catch (error) {
    console.error('Error reading/parsing web_requests.json, starting fresh:', error);
    logs = [];
  }

  logs.push(activityData);

  try {
    fs.writeFileSync(webReqLogFilePath, JSON.stringify(logs, null, 2), 'utf8');
  } catch (error) {
    console.error('Error writing web_requests.json:', error);
  }
}

function logWebSocketEvent(eventData) {
  let logs = [];
  try {
    if (fs.existsSync(wsLogFilePath)) {
      const fileContent = fs.readFileSync(wsLogFilePath, 'utf8');
      if (fileContent) {
        logs = JSON.parse(fileContent);
        if (!Array.isArray(logs)) {
          console.error("ws_req.json was not an array. Resetting.");
          logs = [];
        }
      } else {
        logs = [];
      }
    } else {
      logs = [];
    }
  } catch (error) {
    console.error('Error reading/parsing ws_req.json, starting fresh:', error);
    logs = [];
  }

  logs.push(eventData);

  try {
    fs.writeFileSync(wsLogFilePath, JSON.stringify(logs, null, 2), 'utf8');
  } catch (error) {
    console.error('Error writing ws_req.json:', error);
  }
}

const networkActivityStore = {};
const wsConnections = {};

async function saveCookiesForDomain(domain) {
  if (!domain) {
    console.warn("Attempted to save cookies for an invalid/empty domain.");
    return;
  }
  const cleanDomain = domain.startsWith('.') ? domain.substring(1) : domain;
  const sanitizedDomain = cleanDomain.replace(/[:*?"<>|]/g, '_');
  const domainDataDir = path.join(baseDataDir, sanitizedDomain);
  const cookieFilePath = path.join(domainDataDir, 'cookies.json');
  try {
    await fs.promises.mkdir(domainDataDir, { recursive: true });
    const cookies = await session.defaultSession.cookies.get({ domain: domain });
    await fs.promises.writeFile(cookieFilePath, JSON.stringify(cookies, null, 2), 'utf8');
  } catch (error) {
    console.error(`Error saving cookies for domain ${domain}:`, error);
  }
}

async function handleRequestCompletion(cdpSession, requestId, isError = false, errorText = null) {
    const activityData = networkActivityStore[requestId];
    if (!activityData) {
        return;
    }

    activityData.endTime = Date.now();
    activityData.durationMs = activityData.endTime - (activityData.startTime || activityData.endTime);

    if (isError) {
        activityData.error = errorText || 'Unknown Error';
        logHttpActivity(activityData);
        delete networkActivityStore[requestId];
        return;
    }

    const response = activityData.response;
    const shouldFetchBody = response && response.status !== 301 && response.status !== 302 && response.status !== 204;

    if (shouldFetchBody) {
        try {
            if (cdpSession && cdpSession.isAttached()) {
                const bodyInfo = await cdpSession.sendCommand('Network.getResponseBody', { requestId: requestId });
                activityData.responseBody = bodyInfo.body;
                activityData.responseBodyBase64Encoded = bodyInfo.base64Encoded;
            } else {
                activityData.responseBodyError = "Debugger detached before body could be fetched.";
            }
        } catch (e) {
            activityData.responseBodyError = e.message;
            console.warn(`CDP: Could not get response body for ${activityData.request?.url?.substring(0, 80)} (Req ID: ${requestId}): ${e.message}`);
        }
    } else {
        activityData.responseBodySkipped = true;
    }

    logHttpActivity(activityData);
    delete networkActivityStore[requestId];
}

function createWindow(initialUrl) {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    }
  });

  const ses = session.defaultSession;

  const cdpSession = mainWindow.webContents.debugger;
  try {
    cdpSession.attach('1.3');
  } catch (err) {
    console.error('Failed to attach CDP debugger:', err);
    return;
  }

  cdpSession.sendCommand('Network.enable')
    .catch(err => console.error('Failed to enable CDP Network domain:', err));

  cdpSession.on('message', async (event, method, params) => {
    const eventTimestamp = new Date().toISOString();

    if (method === 'Network.requestWillBeSent') {
        const requestId = params.requestId;
        networkActivityStore[requestId] = {
            requestId: requestId,
            request: params.request,
            initiator: params.initiator,
            type: params.type,
            timestamp: params.timestamp,
            wallTime: params.wallTime,
            startTime: Date.now(),
            response: null,
            responseBody: null,
            responseBodyBase64Encoded: false,
            responseBodyError: null,
            responseBodySkipped: false,
            error: null,
            endTime: null,
            durationMs: null
        };
        if (params.redirectResponse) {
            const redirectData = networkActivityStore[requestId];
            redirectData.response = params.redirectResponse;
            redirectData.responseBodySkipped = true;
        }

    } else if (method === 'Network.responseReceived') {
        const requestId = params.requestId;
        if (networkActivityStore[requestId]) {
            networkActivityStore[requestId].response = params.response;
        }

    } else if (method === 'Network.loadingFinished') {
        await handleRequestCompletion(cdpSession, params.requestId, false);

    } else if (method === 'Network.loadingFailed') {
        await handleRequestCompletion(cdpSession, params.requestId, true, params.errorText);

    } else {
      let logEntry = null;
      const wsUrl = wsConnections[params.requestId] || params.request?.url || params.url || 'Unknown URL';

      switch (method) {
        case 'Network.webSocketCreated':
          wsConnections[params.requestId] = params.url;
          logEntry = { type: 'ws_created', timestamp: eventTimestamp, requestId: params.requestId, url: params.url, initiator: params.initiator || null };
          break;
        case 'Network.webSocketFrameSent':
          logEntry = { type: 'ws_frame_sent', timestamp: eventTimestamp, requestId: params.requestId, url: wsUrl, isOutgoing: true, payload: params.response.payloadData };
          break;
        case 'Network.webSocketFrameReceived':
          logEntry = { type: 'ws_frame_received', timestamp: eventTimestamp, requestId: params.requestId, url: wsUrl, isOutgoing: false, payload: params.response.payloadData };
          break;
        case 'Network.webSocketClosed':
          logEntry = { type: 'ws_closed', timestamp: eventTimestamp, requestId: params.requestId, url: wsUrl, reason: params.reason || '' };
          delete wsConnections[params.requestId];
          break;
        case 'Network.webSocketWillSendHandshakeRequest':
          if (!wsConnections[params.requestId] && params.request?.url) wsConnections[params.requestId] = params.request.url;
          logEntry = { type: 'ws_handshake_request', timestamp: eventTimestamp, requestId: params.requestId, url: wsUrl, headers: params.request.headers };
          break;
        case 'Network.webSocketHandshakeResponseReceived':
          logEntry = { type: 'ws_handshake_response', timestamp: eventTimestamp, requestId: params.requestId, url: wsUrl, status: params.response.status, statusText: params.response.statusText, headers: params.response.headers };
          break;
      }
      if (logEntry) {
        logWebSocketEvent(logEntry);
      }
    }
  });

  mainWindow.on('close', () => {
    try {
      if (cdpSession && cdpSession.isAttached()) {
        cdpSession.detach();
      }
    } catch (err) {}
    Object.keys(networkActivityStore).forEach(id => delete networkActivityStore[id]);
  });

  ses.cookies.on('changed', async (event, cookie, cause, removed) => {
    await saveCookiesForDomain(cookie.domain);
  });

  console.log(`Loading initial URL: ${initialUrl}`);
  mainWindow.loadURL(initialUrl);

  mainWindow.webContents.on('did-finish-load', () => {
    console.log(`Page finished loading: ${mainWindow.webContents.getURL()}`);
  });

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error(`Page failed to load: ${validatedURL}`, errorCode, errorDescription);
 });

  console.log(`Logging HTTP activity (req+res) to: ${webReqLogFilePath}`);
  console.log(`Logging WebSocket events to: ${wsLogFilePath}`);
  console.log(`Saving website data (cookies) to base directory: ${baseDataDir}`);

}


app.whenReady().then(async () => {
  console.log("App Ready. Initializing...");

  try {
    if (!fs.existsSync(baseDataDir)) {
      console.log(`Creating base data directory: ${baseDataDir}`);
      fs.mkdirSync(baseDataDir, { recursive: true });
    }
  } catch (error) {
    console.error(`FATAL: Error creating base data directory ${baseDataDir}:`, error);
    app.quit();
    return;
  }

  [webReqLogFilePath, wsLogFilePath].forEach(filePath => {
    try {
      if (fs.existsSync(filePath)) {
        console.log(`Deleting existing log file: ${path.basename(filePath)}`);
        fs.unlinkSync(filePath);
      }
    } catch (err) {
      console.warn(`Could not delete log file ${path.basename(filePath)}:`, err);
    }
    try {
      fs.writeFileSync(filePath, '[]', 'utf8');
    } catch (initError) {
      console.error(`FATAL: Could not initialize log file ${path.basename(filePath)}!`, initError);
      app.quit();
      return;
    }
  });

  let initialUrl = 'https://www.google.com';
  const urlArgIndex = process.argv.indexOf('--url');
  if (urlArgIndex > -1 && urlArgIndex + 1 < process.argv.length) {
    const potentialUrl = process.argv[urlArgIndex + 1];
    if (potentialUrl.startsWith('http://') || potentialUrl.startsWith('https://')) {
       initialUrl = potentialUrl;
       console.log(`CLI flag --url detected. Setting initial URL to: ${initialUrl}`);
    } else {
        console.warn(`Invalid URL provided via --url: "${potentialUrl}". Using default: ${initialUrl}`);
    }
  } else {
      console.log(`No valid --url flag found. Using default URL: ${initialUrl}`);
  }

  createWindow(initialUrl);

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(initialUrl);
    }
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('quit', () => {
  console.log("Application quitting. Cleaning up...");

  Object.keys(networkActivityStore).forEach(key => delete networkActivityStore[key]);
  Object.keys(wsConnections).forEach(key => delete wsConnections[key]);

  BrowserWindow.getAllWindows().forEach(window => {
    try {
      if (window.webContents && !window.webContents.isDestroyed() && window.webContents.debugger.isAttached()) {
        window.webContents.debugger.detach();
      }
    } catch (e) {}
  });
  console.log("Cleanup complete. Exiting.");
});