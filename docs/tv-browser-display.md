# Church TV browser display

CSpot can send the live slideshow directly to a television's native browser.
The TV fetches slide state and content from the server, so it does not need to
be connected to the presenter computer as an external monitor.

## One-time TV setup

1. Open the short CSpot TV address in the TV browser:

   ```text
   https://<church-app-host>/app/tv
   ```

   The older `?presentation=tv` address remains supported. Public HTTP links
   are upgraded to HTTPS automatically so the browser can retain its secure
   sign-in session.

2. Sign in with the dedicated viewer account's username or email address. TV
   display login defaults to **Keep me signed in on this device** and uses both
   modern and legacy cookie expiry attributes for older television browsers. A
   viewer has the read permissions required to render plans without presentation
   or editing permissions.
3. Bookmark the `/app/tv` URL.
4. Select **Fullscreen** on the TV once. Browsers require a local click before a
   page can enter fullscreen; CSpot cannot trigger this remotely.

The waiting screen can remain open. It automatically discovers the active TV
output, follows every slide change, and returns to waiting when the presenter
stops it. Refreshing or reopening the TV page does not interrupt the presenter.

## During a service

1. Open the service in **Present** on a laptop, tablet, or other controller.
2. Select **Start TV** instead of **Start Slides**.
3. Use the normal slide sorter, section rail, keyboard navigation, blanking, and
   media controls. State travels through the CSpot server to the television.
4. Select **Stop TV** when the service is over.

The presenter device remains the controller, but it no longer needs a video
cable, extended desktop, or local output window. More than one signed-in TV page
can passively follow the same active service.

## Operational notes

- Prefer wired Ethernet or strong church Wi-Fi for both devices.
- Disable the television's sleep timer and browser energy-saving timeout.
- Native TV browsers may require a local Play click before video or audible
  media can start because of autoplay policies.
- Use a least-privilege dedicated viewer account on the TV, not an administrator
  account.
- If the controller loses connectivity, the TV keeps the last slide visible and
  returns to waiting after the server heartbeat expires.
