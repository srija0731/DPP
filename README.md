# Drone Path Planner — RRT + DWA demo

A local browser-based route-planning prototype with OpenStreetMap tiles, manually editable named locations, RRT route alternatives, a DWA-style local route, and a demo owner-only status panel.

## Requirements
- Python 3.9+
- Internet access in the browser for OpenStreetMap map tiles and Leaflet CDN assets

## Run it
1. Extract the ZIP.
2. Open a terminal in the extracted `drone_path_planner` folder.
3. Run `python main.py` (Windows may use `py main.py`).
4. Visit http://127.0.0.1:8000

## How to use
- Pick named places from the Start and End dropdowns, or type coordinates in the latitude/longitude fields.
- **Calculate RRT routes** generates several randomized RRT candidates. Candidates are shown in blue; the shortest returned candidate is highlighted green.
- **Calculate DWA route** runs a simplified Dynamic Window Approach-style local planner and displays its selected route in green.
- **Owner view** opens a demo password gate and then shows simulated drone status and editable hazard controls.
- Click the map to set a manual start/end point using the map click mode buttons.
- `maps.json` is the source for named places and initial demo obstacles.

## Owner access note
This is only a local demonstration. The password in `maps.json` is visible to anyone who can access the file and is not secure authentication. Do not deploy it publicly as-is. For real access control, use server-side authentication, hashed credentials, HTTPS, sessions, and authorization on every protected API.

## Safety note
RRT and DWA implementations here are educational map-coordinate simulations. The obstacles are illustrative circles, not verified aviation data. The route does not account for altitude, wind, battery, no-fly-zone databases, terrain, moving-object prediction, GPS error, or regulations. Never use this prototype to control a real drone or treat its output as a flight-safe route.

## Files
- `main.py`: entry point
- `server.py`: HTTP server and route-planning API
- `maps.json`: editable places and simulated obstacles
- `frontend/index.html`: user interface
- `frontend/style.css`: styling
- `frontend/app.js`: map, route rendering, UI behavior
