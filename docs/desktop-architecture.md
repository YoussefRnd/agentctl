# Desktop ownership and lifecycle

The Electron main process composes one `desktopRuntime`. It awaits the utility server before
registering IPC, update subscriptions, tray integration, and the shared web renderer. Repeated
start and stop calls share their in-flight operation. Shutdown blocks late window creation,
disposes native subscriptions, cancels pending server startup, and awaits graceful server exit
before allowing Electron to quit. The server manager validates port and capability readiness,
rejects every exit before readiness, clears credentials on exit, kills timed-out startup, and
permits a later explicit restart. Unexpected exits after readiness terminate the application
with a reported failure instead of leaving a disconnected native shell.

| Area                     | Owner                                                           | Decision                                                                                                                                                    |
| ------------------------ | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Main entry and lifecycle | `main/index.ts`, `lifecycle/`                                   | Composition, single instance, menu, signals, and awaited shutdown; tested races live in `desktopRuntime.test.ts`                                            |
| Utility server           | `server/`, `server-process.ts`                                  | One process and one database owner; transport readiness validation; server package owns application composition and cleanup                                 |
| Native IPC               | `ipc/`                                                          | Every command and query checks the current main window and its main frame; validates external protocols and tray counters; unregisters handlers on shutdown |
| Window/deep links        | `windows/`, `windowControls.ts`                                 | One window, pending startup links, renderer subscription handshake, platform capability resolution                                                          |
| Tray                     | `tray/`                                                         | Status projection, native menu, explicit disposal; unsupported tray environments degrade gracefully                                                         |
| Updates                  | `updates/`                                                      | Updater event subscriptions, IPC listeners and development timer share explicit disposers; install requires a downloaded update                             |
| Preload                  | `preload/index.ts`                                              | Context bridge exposes named operations only; subscriptions return idempotent removal functions                                                             |
| Shared native DTOs       | `packages/shared/src/types/desktop.ts`                          | One renderer/main/preload contract, with no Electron runtime import; web declaration consumes it                                                            |
| Renderer adapter         | `apps/web/src/app/useNativeNavigation.ts`                       | Local route validation and subscription cleanup; absent native API leaves browser routing intact                                                            |
| Build/package            | `electron.vite.config.ts`, `electron-builder.yml`, `resources/` | Shared web renderer; isolated preload and utility entry; native dependencies externalized; migrations copied and cached as build outputs                    |

`node scripts/desktop-smoke.mjs <report.json>` launches the **built Electron application**, its
real preload, window, and embedded server using a temporary database, profile and agent home.
On Linux it starts Xvfb when no DISPLAY exists (`XVFB_PATH` can select a locally extracted
binary). It verifies capability IPC, HTTP readiness, deep-link delivery, listener removal,
untrusted-window denial, exactly one server owner and server exit before app quit. A separate
launch makes the actual utility process fail before readiness and verifies that no window is
opened and shutdown completes. OS protocol registration is stubbed only in this isolated
harness so a test never changes the user's desktop association. Reports include platform,
scenario and individual checks; failures retain logs. CI and release run the same command.

The available native acceptance environment is Linux x64 with Xvfb. macOS and Windows native
runtime checks remain open platform checks; the Linux CI job is not evidence for those hosts.
Signing, updater downloads/installing a release, visual tray interaction, and OS protocol
registration are release/platform acceptance work beyond this lifecycle smoke. Unit tests
cover the shared lifecycle and IPC policies; a browser-hosted renderer is supplementary evidence.
