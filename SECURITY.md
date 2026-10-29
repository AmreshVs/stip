# Security

## Supported versions

Only the latest release of Stip gets security fixes.

## Reporting a vulnerability

Please don't open a public issue for security problems. Report them privately through GitHub instead: open the repository's **Security** tab and choose **Report a vulnerability**.

Include what you found, the steps to reproduce it, and the Stip version and OS you used. You'll get a reply within a week, and a fix or a plan as soon as the problem is confirmed.

## What Stip does with your data

Stip makes no network requests. Your settings and stats are stored only as JSON files in the app's user data folder on your computer:

- macOS: `~/Library/Application Support/Stip`
- Windows: `%APPDATA%\Stip`
- Linux: `~/.config/Stip`

To detect Zoom calls, Stip reads the names of running processes every 15 seconds. It never records or stores that list.
