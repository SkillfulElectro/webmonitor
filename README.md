# WebMonitor

## Overview

This is a simple application designed to monitor website activity. It launches a browser window loading a specified URL (or Google.com by default) and logs various network interactions and data storage occurring on the visited pages.

## Features

*   **HTTP Request/Response Logging:** Captures details of HTTP/HTTPS requests, including URL, method, request headers, request body, response status, response headers, and response body (where possible). Logs are saved to `web_requests.json`.
*   **WebSocket Logging:** Captures WebSocket connection lifecycle events (creation, closure) and data frames sent/received. Logs are saved to `ws_req.json`.
*   **Cookie Monitoring & Saving:** Detects changes to cookies and saves the current set of cookies for each domain to a dedicated directory structure (`web_datas/<domain>/cookies.json`).
*   **Custom Start URL:** Allows specifying a target URL via a command-line flag.
*   **Automatic Log Cleanup:** Deletes previous log files (`web_requests.json`, `ws_req.json`) upon each application start to ensure fresh logs for the current session.

## Prerequisites

*   [Node.js](https://nodejs.org/) (includes npm) - Ensure you have a recent LTS version installed.

## Installation

1.  **Clone or Download:** Get the project files onto your local machine.
2.  **Navigate to Directory:** Open your terminal or command prompt and change into the project's root directory (where `package.json` and `main.js` are located).
3.  **Install Dependencies:** Run the following command to install Electron and any other necessary packages:
    ```bash
    npm install
    ```

## Usage

1.  **Run with Default URL (Google.com):**
    Open your terminal in the project directory and run:
    ```bash
    npm start
    ```
    A window will open, loading `https://www.google.com`.

2.  **Run with a Specific URL:**
    To load a different website, use the `--url` flag followed by the full URL (including `http://` or `https://`). Note the extra `--` needed when using `npm start`:
    ```bash
    npm start -- --url https://www.google.com
    ```

## Output Files

The application generates the following files and directories in the same directory where you run `npm start`:

*   **`web_requests.json`**: Contains an array of JSON objects, each representing a logged HTTP/HTTPS request and its corresponding response data (headers, status, body, etc.).
*   **`ws_req.json`**: Contains an array of JSON objects, each representing a logged WebSocket event (connection created, frame sent/received, connection closed).
*   **`web_datas/`**: This directory contains subdirectories for each domain that sets cookies during the session.
    *   **`web_datas/<domain_name>/cookies.json`**: Inside each domain's subdirectory, this file contains an array of JSON objects representing the cookies currently set for that specific domain. This file is updated whenever a cookie change is detected for that domain.

## Known Limitations

*   **Anti-Automation Measures:** Websites with sophisticated bot detection (like Google login pages) may still block certain actions or display security warnings, as completely mimicking a standard browser is very difficult.
*   **Response Body Access:** While the app attempts to capture response bodies using the Chrome DevTools Protocol, this may fail for certain types of responses (e.g., very large files, specific stream types) or if the connection closes prematurely.