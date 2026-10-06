# SELT.OS

**Simulated Environment for Learning Technology, Operations & Security**

SELT.OS is a static, browser-based learning desktop designed to provide small, interactive technical environments without requiring a backend, database, API, container, or external service.

The idea is simple:

> **Open the desktop → choose an environment → open a self-contained lab → experiment, understand, reset, and continue.**

SELT.OS is not intended to reproduce a complete operating system. It is a lightweight desktop-style shell for organizing and launching isolated learning environments.

---

## Why SELT.OS?

Many technical learning resources explain concepts through documentation, commands, or vulnerable applications that require a separate setup.

SELT.OS takes a different approach:

- provide a familiar desktop-like interface;
- organize labs into technical environments;
- keep each lab self-contained;
- make experiments resettable;
- avoid infrastructure requirements for the current version;
- make it possible to expand the project by adding new environments.

The desktop is therefore intentionally lightweight. The **environment owns the simulation**, while SELT.OS mainly provides the shell, navigation, windows, workspaces, and launch mechanism.

---

## V1 Scope

The current V1 contains:

### Desktop

- Desktop-style shell
- Top bar
- Four workspaces
- Floating application windows
- Window dragging
- Window resizing
- Minimize / restore
- Maximize
- Basic tiling mode
- Active-window management
- Minimized-window dock
- Application launcher
- Settings
- About information
- Keyboard shortcut panel
- Local theme selection
- Clock and desktop status elements

### Learning environments

V1 currently exposes **7 labs** across four technical areas.

#### Cybersecurity — SQL Injection

1. **Authentication Bypass**
   - Explore how user-controlled input can alter a login query.

2. **Product Search**
   - Explore boolean logic and unintended data exposure.

3. **Data Exfiltration**
   - Explore simulated `UNION SELECT`-style data extraction.

4. **Order By Injection**
   - Explore an unquoted `ORDER BY` parameter and its effect on sorting and data exposure.

#### Cybersecurity — Access Control

5. **Invoice Portal (IDOR)**
   - Explore broken object-level authorization through a simulated invoice portal.

#### Cybersecurity — Cross-Site Scripting

6. **Reflected Search**
   - Explore reflected input, browser-side script execution, and the corresponding mitigation concept.

#### Systems Administration — Linux

7. **File Permissions**
   - Practice predicting Linux file-access decisions and correcting simulated permission misconfigurations.

The environments are browser simulations. They do not connect to real external targets.

---

## Architecture

SELT.OS follows a deliberately simple architecture:

```text
                         SELT.OS
                            │
              ┌─────────────┴─────────────┐
              │                           │
        Desktop Shell              Environment Manager
              │                           │
      ┌───────┼────────┐          ┌───────┼───────────────┐
      │       │        │          │       │       │       │
   Windows  Apps   Workspaces    SQLi   Access   XSS    Linux
                                  │      Control
                                  │
                         Self-contained labs
```

The important design principle is:

> **SELT.OS launches environments; environments own their simulations.**

This keeps the desktop from becoming tightly coupled to individual labs.

### Environment model

Each environment is represented in `js/environments.js`.

A category contains one or more environments, and each environment exposes one or more lab paths:

```text
environments/
├── sql-injection/
│   ├── 01-authentication/
│   ├── 02-product-search/
│   ├── 03-data-exfiltration/
│   └── 04-order-by-injection/
│
├── access-control/
│   └── 01-idor/
│
├── xss/
│   └── 01-reflected/
│
└── linux/
    └── 01-permissions/
```

Each lab currently has its own HTML and JavaScript simulation.

---

## Project Structure

```text
SELT.OS/
│
├── index.html
│
├── css/
│   ├── theme.css
│   ├── desktop.css
│   ├── windows.css
│   ├── components.css
│   └── labs.css
│
├── js/
│   ├── desktop.js
│   ├── environments.js
│   ├── shortcuts.js
│   ├── terminal.js
│   └── window-manager.js
│
└── environments/
    │
    ├── sql-injection/
    │   ├── 01-authentication/
    │   │   ├── index.html
    │   │   └── script.js
    │   ├── 02-product-search/
    │   │   ├── index.html
    │   │   └── script.js
    │   ├── 03-data-exfiltration/
    │   │   ├── index.html
    │   │   └── script.js
    │   └── 04-order-by-injection/
    │       ├── index.html
    │       └── script.js
    │
    ├── access-control/
    │   └── 01-idor/
    │       ├── index.html
    │       └── script.js
    │
    ├── xss/
    │   └── 01-reflected/
    │       ├── index.html
    │       └── script.js
    │
    └── linux/
        └── 01-permissions/
            ├── index.html
            └── script.js
```

---

## Running SELT.OS

SELT.OS is intended to run locally in a browser.

### Option 1 — Open directly

Open:

```text
index.html
```

in a modern browser.

### Option 2 — Use a local static server

For a more consistent browser environment, serve the project directory with any simple static HTTP server.

For example, with Python:

```bash
python3 -m http.server
```

Then open the local address shown by Python.

### Option 3 — GitHub Pages

The project is also available online via GitHub Pages, with no setup required:

```text
https://hosnizaaraoui.github.io/SELTOS/
```

No package installation is required by the project itself.

---

## Keyboard Shortcuts

| Shortcut    | Action                    |
| ----------- | ------------------------- |
| `Super + D` | Open application launcher |
| `Super + N` | Open Environments         |
| `Super + K` | Open Terminal             |
| `Super + H` | Open shortcut cheat-sheet |
| `Super + S` | Open Settings             |
| `Super + Q` | Close active window       |
| `Super + 1` | Workspace 1               |
| `Super + 2` | Workspace 2               |
| `Super + 3` | Workspace 3               |
| `Super + 4` | Workspace 4               |
| `Esc`       | Close overlays            |

### Browser fallback

Normal desktop browsers and operating systems may intercept combinations involving the `Super` / `Meta` key.

For browser testing, SELT.OS also provides:

```text
Ctrl + Alt + D
Ctrl + Alt + N
Ctrl + Alt + K
Ctrl + Alt + H
Ctrl + Alt + S
Ctrl + Alt + Q
Ctrl + Alt + 1..4
```

These mirror the corresponding desktop shortcuts.

---

## Themes

The desktop currently includes three selectable visual themes:

- Dracula
- Nord
- Green

The selected theme is stored locally in browser `localStorage`.

The visual design intentionally uses a dark, minimal, translucent desktop aesthetic without depending on a specific Linux distribution or desktop environment.

---

## Terminal

V1 includes a lightweight **simulated application terminal**.

It is not a real system shell and does not execute arbitrary operating-system commands.

Its current purpose is to provide desktop interaction and a small command interface for SELT.OS applications.

Available commands include:

```text
settings
env
environments
about
apps
help
```

This distinction is intentional: SELT.OS remains a browser application rather than pretending to provide access to the host operating system.

---

## No Backend by Design

SELT.OS V1 does not require:

- a backend server;
- a database;
- an API;
- Docker;
- a cloud service;
- a package manager;
- authentication infrastructure;
- external dependencies.

The simulations run locally in the browser.

This makes the project easy to copy, inspect, run, and modify.

It also makes SELT.OS suitable for offline/local learning scenarios where a full lab infrastructure would be inconvenient.

---

## Adding a New Environment

The environment registry is located at:

```text
js/environments.js
```

A new lab can be added by creating a directory under `environments/` and registering its path.

For example:

```text
environments/
└── networking/
    └── 01-dns/
        ├── index.html
        └── script.js
```

Then add the corresponding environment and lab entry to `js/environments.js`.

The desktop does not need to know how the lab works internally. It only needs its metadata and path.

This is one of the core architectural goals of SELT.OS.

---

## Design Principles

### 1. Self-contained environments

A lab should contain its own simulation logic instead of depending on the desktop.

### 2. Separation of shell and content

The desktop manages:

- windows;
- workspaces;
- launching;
- shortcuts;
- themes;
- navigation.

The environment manages:

- its interface;
- its simulation;
- its state;
- its learning interaction.

### 3. Local-first

V1 should work without relying on external infrastructure.

### 4. Small simulations

The goal is not to reproduce an entire production system.

Instead, each environment focuses on one technical concept and creates enough simulation to make that concept interactive.

### 5. Resettable learning

Labs should make experimentation easy and allow the learner to return to a clean state.

### 6. Expandable structure

New technical domains should be addable without rewriting the desktop.

---

## Current Limitations

SELT.OS V1 is intentionally limited.

The project currently does **not** provide:

- real virtual machines;
- real Linux environments;
- real network namespaces;
- real databases;
- real vulnerable web servers;
- real remote targets;
- multi-user infrastructure;
- persistent lab backends;
- automated lab discovery from arbitrary folders;
- a package/plugin system.

The cybersecurity environments are simulations running inside the browser.

This is important because the project is designed as a lightweight learning platform, not as a replacement for infrastructure-based security labs.

---

## Roadmap

The following ideas are potential future directions rather than promises of the current V1.

### More cybersecurity environments

Potential areas include:

- additional SQL injection concepts;
- XSS variants;
- authentication weaknesses;
- access-control flaws;
- command-injection simulations;
- path traversal;
- security headers;
- session and cookie concepts;
- input validation;
- encoding and sanitization.

### Systems administration

Potential environments include:

- Linux permissions;
- users and groups;
- SSH;
- services;
- processes;
- logs;
- cron;
- filesystem concepts;
- networking tools;
- firewall concepts.

### Networking

Potential future simulations could cover:

- IP addressing;
- subnetting;
- DNS;
- routing;
- ports;
- firewall rules;
- VLAN concepts;
- packet-flow reasoning.

### Desktop improvements

Potential improvements include:

- richer application management;
- improved workspace behavior;
- more window-management features;
- environment search and filtering;
- progress tracking;
- lab metadata;
- better reset/state handling.

---

## Safety & Learning Scope

SELT.OS is intended for **local, educational simulation**.

The cybersecurity environments are designed to explain security concepts through controlled browser-based scenarios. They should not be treated as instructions for attacking systems that you do not own or have permission to test.

The purpose of the project is to understand **why a vulnerability exists, how a simulated system behaves, and how it can be mitigated**.

---

## Project Status

**SELT.OS V1 — Early development**

The current version establishes the core architecture:

```text
Desktop
   ↓
Environment Manager
   ↓
Environment
   ↓
Self-contained Lab
   ↓
Interactive Simulation
```

The project is intentionally being built incrementally. The desktop shell comes first; environments can then grow independently.

---

## License

No license is currently specified by the project.

If this repository is published publicly, add a license file and update this section accordingly.

---

## Author

**Hosni Zaaraoui**

SELT.OS is part of a broader collection of practical projects and technical learning work focused on Linux, systems administration, networking, cybersecurity, and automation.
