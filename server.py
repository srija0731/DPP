"""Small standard-library HTTP server for the drone route planner."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse
import json, os, math, random
from pathlib import Path

ROOT = Path(__file__).resolve().parent
HOST, PORT = "127.0.0.1", 8000

def dist(a, b):
    return math.hypot(a[0]-b[0], a[1]-b[1])

def segment_point_distance(p, a, b):
    dx, dy = b[0]-a[0], b[1]-a[1]
    if dx == dy == 0: return dist(p, a)
    t = max(0.0, min(1.0, ((p[0]-a[0])*dx + (p[1]-a[1])*dy)/(dx*dx+dy*dy)))
    return dist(p, (a[0]+t*dx, a[1]+t*dy))

def blocked(a, b, obstacles, clearance=0.00012):
    for o in obstacles:
        if o.get("type") == "circle":
            center = (float(o["lng"]), float(o["lat"]))
            radius = float(o.get("radius", 0.0002)) + clearance
            if segment_point_distance(center, a, b) < radius:
                return True
    return False

def line_clear(path, obstacles):
    return all(not blocked(path[i], path[i+1], obstacles) for i in range(len(path)-1))

def rrt_paths(start, goal, obstacles, count=5, seed=17):
    """Plan several randomized RRT paths in a bounded lon/lat box."""
    rng = random.Random(seed)
    minx, maxx = sorted([start[0], goal[0]])
    miny, maxy = sorted([start[1], goal[1]])
    padx = max((maxx-minx)*0.65, 0.0015)
    pady = max((maxy-miny)*0.65, 0.0015)
    minx -= padx; maxx += padx; miny -= pady; maxy += pady
    results = []
    for attempt in range(count * 3):
        nodes = [start]; parents = [-1]
        goal_idx = None
        for _ in range(2600):
            sample = goal if rng.random() < 0.14 else (rng.uniform(minx,maxx), rng.uniform(miny,maxy))
            near = min(range(len(nodes)), key=lambda i: dist(nodes[i], sample))
            dx, dy = sample[0]-nodes[near][0], sample[1]-nodes[near][1]
            d = math.hypot(dx,dy) or 1
            step = min(0.00045, d)
            nxt = (nodes[near][0]+dx/d*step, nodes[near][1]+dy/d*step)
            if not blocked(nodes[near], nxt, obstacles):
                nodes.append(nxt); parents.append(near)
                if dist(nxt, goal) < 0.00048 and not blocked(nxt, goal, obstacles):
                    nodes.append(goal); parents.append(len(nodes)-2)
                    goal_idx = len(nodes)-1; break
        if goal_idx is not None:
            path=[]; idx=goal_idx
            while idx >= 0:
                path.append(nodes[idx]); idx=parents[idx]
            path.reverse()
            # Shortcut to remove unnecessary bends.
            i=0
            while i < len(path)-2:
                j=len(path)-1
                while j > i+1 and blocked(path[i],path[j],obstacles): j-=1
                path=path[:i+1]+path[j:]
                i+=1
            if len(path)>=2 and all(len(path) != len(p) or any(dist(x,y)>1e-8 for x,y in zip(path,p)) for p in results):
                results.append(path)
        if len(results) >= count: break
    return results

def path_length(path):
    return sum(dist(path[i],path[i+1]) for i in range(len(path)-1))

def dwa_path(start, goal, obstacles):
    """A lightweight Dynamic Window Approach-style local planner in map coordinates.
    Returns a waypoint path; it is a visualization/demo, not flight-control software.
    """
    pos = [start[0], start[1]]
    heading = math.atan2(goal[1]-start[1], goal[0]-start[0])
    path = [tuple(pos)]
    step = 0.00018
    for _ in range(450):
        if dist(tuple(pos), goal) < 0.00022:
            path.append(goal); return path
        best = None; best_score = float("inf")
        # Sample headings around the current direction and score progress + obstacle clearance.
        for delta in [i*math.pi/18 for i in range(-8,9)]:
            ang = heading + delta
            nxt = (pos[0]+math.cos(ang)*step, pos[1]+math.sin(ang)*step)
            if blocked(tuple(pos), nxt, obstacles, clearance=0.00009): continue
            goal_dist = dist(nxt, goal)
            clearance = min([segment_point_distance((float(o["lng"]),float(o["lat"])), tuple(pos), nxt)-float(o.get("radius",0.0002)) for o in obstacles if o.get("type")=="circle"] or [0.01])
            score = goal_dist + abs(delta)*0.00008 + 0.00012/max(clearance,0.00001)
            if score < best_score:
                best_score=score; best=(nxt,ang)
        if best is None: return []
        pos=[best[0][0],best[0][1]]; heading=best[1]; path.append(tuple(pos))
    return []

def clean_path(path):
    return [[round(p[0],7), round(p[1],7)] for p in path]

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_POST(self):
        if urlparse(self.path).path != "/api/plan":
            self.send_error(404); return
        try:
            n = int(self.headers.get("Content-Length", "0"))
            data = json.loads(self.rfile.read(n).decode("utf-8"))
            start = (float(data["start"]["lng"]), float(data["start"]["lat"]))
            goal = (float(data["end"]["lng"]), float(data["end"]["lat"]))
            obstacles = data.get("obstacles", [])
            algorithm = data.get("algorithm", "rrt")
            if dist(start,goal) < 0.00001:
                raise ValueError("Start and end points must be different.")
            if algorithm == "rrt":
                paths = rrt_paths(start, goal, obstacles, count=6)
                if not paths:
                    self.reply(422, {"error":"RRT could not find a path. Move the points or adjust obstacles."}); return
                paths.sort(key=path_length)
                self.reply(200, {"algorithm":"RRT","routes":[clean_path(p) for p in paths],
                                 "optimal":clean_path(paths[0]),"lengths":[round(path_length(p)*111000,1) for p in paths]})
            elif algorithm == "dwa":
                path = dwa_path(start, goal, obstacles)
                if not path:
                    self.reply(422, {"error":"DWA could not find a safe route in its search window. Try another start/end or obstacle placement."}); return
                self.reply(200, {"algorithm":"DWA","routes":[clean_path(path)],"optimal":clean_path(path),
                                 "lengths":[round(path_length(path)*111000,1)]})
            else:
                self.reply(400, {"error":"Unknown algorithm."})
        except (KeyError, ValueError, TypeError, json.JSONDecodeError) as e:
            self.reply(400, {"error":"Invalid request: " + str(e)})

    def reply(self, status, obj):
        raw=json.dumps(obj).encode()
        self.send_response(status); self.send_header("Content-Type","application/json")
        self.send_header("Content-Length",str(len(raw))); self.end_headers(); self.wfile.write(raw)

def run():
    print(f"Drone Path Planner running at http://{HOST}:{PORT}")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()

if __name__ == "__main__":
    run()
