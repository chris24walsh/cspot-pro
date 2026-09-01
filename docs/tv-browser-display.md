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
The TV route is deliberately visual-only: pre-service music, song backing
tracks, and video audio are always muted on `/app/tv`.

## Church PC media receiver

Open `https://<church-app-host>/app/media` in a browser on the church PC and
leave it running. This dedicated receiver follows the same remote presentation
state but plays only the program-media audio needed for pre-service music, song
backing tracks, and video items. Route that browser to the Windows playback
endpoint connected to the sound desk. The Audio Bridge can capture the same
endpoint as `pc-media`, while the physical line-out supplies the desk and room
speakers.

The media receiver and TV display remain separate so the church TV never emits
sound. Browsers may require autoplay permission for the CSpot origin before
remote commands can start audible media. The church PC also needs an active
interactive Windows session; a browser cannot render audio while every user is
logged out.

## During a service

1. Open the service in **Present** on a laptop, tablet, or other controller.
2. Select **Start**. By default CSpot enables the TV output without opening a
   local slideshow window. To use a local projector window instead, open the
   dropdown on the right edge of **Start**, select **Open slideshow in new
   window**, and then select **Start**.
3. Use the normal slide sorter, section rail, keyboard navigation, blanking, and
   media controls. State travels through the CSpot server to the television.
4. Select **Stop** when the service is over.

The presenter device remains the controller while it is open, but the TV output
continues if that device closes the tab, closes the browser, or navigates away.
Another presenter device can reconnect to the same service and stop the TV
output explicitly. No video cable, extended desktop, or local output window is
required. More than one signed-in TV page can passively follow the same active
service.

## Operational notes

- Prefer wired Ethernet or strong church Wi-Fi for both devices.
- Disable the television's sleep timer and browser energy-saving timeout.
- Native TV browsers may require a local Play click before video can start,
  although TV playback remains muted. The church PC media receiver must be
  granted permission for audible autoplay.
- Use a least-privilege dedicated viewer account on the TV, not an administrator
  account.
- If the controller loses connectivity or its screen locks, the active session
  and last slide remain available until a presenter reconnects.
- Closing every display does not stop the session. Use **Stop** on any
  presenter device to return TV displays and Broadcast to their waiting/offline
  states.
