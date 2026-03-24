import React, { useEffect, useRef, useState, useMemo } from "react";

const checkIntersect = (p1, p2, p3, p4, isTrimMode = false) => {
  const den = (p4.y - p3.y) * (p2.x - p1.x) - (p4.x - p3.x) * (p2.y - p1.y);
  if (Math.abs(den) < 1e-10) return null;
  const ua = ((p4.x - p3.x) * (p1.y - p3.y) - (p4.y - p3.y) * (p1.x - p3.x)) / den;
  const ub = ((p2.x - p1.x) * (p1.y - p3.y) - (p2.y - p1.y) * (p1.x - p3.x)) / den;
  if (ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1) {
    return { x: p1.x + ua * (p2.x - p1.x), y: p1.y + ua * (p2.y - p1.y) };
  }
  return null;
};

const CncWorkspace = () => {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const [mode, setMode] = useState("DRAW_LINE");
  const [lineMode, setLineMode] = useState("G01");
  const [arcSubMode, setArcSubMode] = useState("SER");
  const [circleSubMode, setCircleSubMode] = useState("CEN");
  const [paths, setPaths] = useState([]);
  const [history, setHistory] = useState([]);
  const [selectedPathId, setSelectedPathId] = useState(null);
  
  const [selRange, setSelRange] = useState({ pathId: null, p1: null, p2: null });
  const [transform, setTransform] = useState({ dz: "", dx: "", scale: "1" });

  const [isInner, setIsInner] = useState(false);
  const [isOrtho, setIsOrtho] = useState(false);
  const [bgImage, setBgImage] = useState(null);
  const [bgOpacity, setBgOpacity] = useState(0.5);
  const [offsetDist, setOffsetDist] = useState(2.0);
  const [chamferType, setChamferType] = useState("c");
  const [chamferVal, setChamferVal] = useState(2.0);
  const [toolConfig, setToolConfig] = useState({
    code: "0101",
    r: 0.8,
    angle: 55,
    color: "#00FFFF",
  });
  const [stock, setStock] = useState({ od: 80, id: 0, length: 120, face: 2.0 });
  const [cam, setCam] = useState({
    vc: 200,
    g50: 2500,
    feed: 0.2,
    doc: 2.0,
    safeDist: 2.0,
    allowX: 0.5,
    allowZ: 0.1,
  });
  const [gcode, setGcode] = useState("");

  const canvasRef = useRef(null);
  const cameraRef = useRef({
    x: window.innerWidth / 2 - (isMobile ? 0 : 150),
    y: window.innerHeight / (isMobile ? 4 : 2),
    zoom: 1.5,
  });

  const interactionRef = useRef({
    isDragging: false,
    lastMouse: { x: 0, y: 0 },
    continuous: false,
    currentPt: { x: 0, y: 0 },
    isSnapped: false,
    trimPath: [],
    circleStart: null,
    tangentCircle: null,
    arcPts: [],
    hoveredPathId: null,
    hoveredPtIdx: null,
    hoveredSegment: null, // 🔥 新增：用於記錄目前被選中的「單一線段」
    sim: { active: false, progress: 0, pts: [] },
    initialPinchDist: null,
    initialZoom: null,
  });

  const saveState = () => {
    setHistory((prev) => {
      const curStr = JSON.stringify(paths);
      if (prev.length > 0 && JSON.stringify(prev[prev.length - 1]) === curStr) return prev;
      return [...prev.slice(-29), JSON.parse(curStr)];
    });
  };
    
  const handleUndo = () => {
    setHistory((prev) => {
      if (prev.length === 0) return prev;
      const newH = [...prev];
      setPaths(newH.pop());
      return newH;
    });
    interactionRef.current.continuous = false;
    interactionRef.current.circleStart = null;
    interactionRef.current.arcPts = [];
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        interactionRef.current.continuous = false;
        interactionRef.current.circleStart = null;
        interactionRef.current.arcPts = [];
        setPaths((p) => [...p]);
      }
      if (e.key === "z" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleUndo();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [paths]);

  const applyTransform = () => {
    saveState();
    setPaths((prev) => {
      const n = JSON.parse(JSON.stringify(prev));
      const path = n.find((p) => p.id === activePath?.id);
      if (!path) return n;
      const s = parseFloat(transform.scale);
      const dz = parseFloat(transform.dz) || 0;
      const dx = parseFloat(transform.dx) || 0;
      const scaleVal = isNaN(s) ? 1 : s;

      path.points.forEach((pt) => {
        pt.x = pt.x * scaleVal + dz;
        pt.y = pt.y * scaleVal - (dx / 2);
      });
      return n;
    });
    setTransform({ dz: "", dx: "", scale: "1" });
  };

  const handlePointChange = (pathId, ptIdx, axis, val) => {
    setPaths((prev) => {
      const n = JSON.parse(JSON.stringify(prev));
      const path = n.find((p) => p.id === pathId);
      if (!path) return n;
      const pts = path.points;
      const pt = pts[ptIdx];
      if (!pt) return n;

      const isClosed = pts.length > 2 && Math.hypot(pts[0].x - pts[pts.length-1].x, pts[0].y - pts[pts.length-1].y) < 0.001;

      const numVal = parseFloat(val);
      if (!isNaN(numVal)) {
        if (axis === "Z") pt.x = numVal;
        if (axis === "X") pt.y = -numVal / 2;
      }

      if (isClosed) {
        if (ptIdx === 0) {
          pts[pts.length - 1].x = pts[0].x;
          pts[pts.length - 1].y = pts[0].y;
        } else if (ptIdx === pts.length - 1) {
          pts[0].x = pts[pts.length - 1].x;
          pts[0].y = pts[pts.length - 1].y;
        }
      }
      return n;
    });
  };

  const getVisualPoints = (pts) => {
    if (!pts || !Array.isArray(pts)) return [];
    if (pts.length < 2) return pts.map((p) => ({ ...p }));

    let res = [];
    const isClosed =
      pts.length > 2 &&
      Math.hypot(
        pts[0].x - pts[pts.length - 1].x,
        pts[0].y - pts[pts.length - 1].y
      ) < 0.001;
    let closedCornerPA = null;

    for (let i = 0; i < pts.length; i++) {
      const pt = pts[i];
      if (!pt || typeof pt.x === "undefined" || typeof pt.y === "undefined") continue;

      let applyCR = false;
      let p, n;
      let currentC = pt.c || 0;
      let currentR = pt.r || 0;

      if (isClosed && (i === 0 || i === pts.length - 1)) {
        currentC = pts[0].c || pts[pts.length - 1].c || 0;
        currentR = pts[0].r || pts[pts.length - 1].r || 0;
        if (currentC > 0 || currentR > 0) {
          applyCR = true;
          p = pts[pts.length - 2];
          n = pts[1];
        }
      } else if ((currentC > 0 || currentR > 0) && i > 0 && i < pts.length - 1) {
        applyCR = true;
        p = pts[i - 1];
        n = pts[i + 1];
      }

      if (applyCR && p && n) {
        const v1 = { x: p.x - pt.x, y: p.y - pt.y },
              v2 = { x: n.x - pt.x, y: n.y - pt.y };
        const l1 = Math.hypot(v1.x, v1.y),
              l2 = Math.hypot(v2.x, v2.y);

        if (l1 < 0.001 || l2 < 0.001) {
          if (i === pts.length - 1 && isClosed && closedCornerPA) {
            res.push({ ...closedCornerPA });
          } else {
            res.push({ ...pt });
          }
          continue;
        }
        v1.x /= l1;
        v1.y /= l1;
        v2.x /= l2;
        v2.y /= l2;

        let pA, pB;
        if (currentC > 0) {
          const c = parseFloat(currentC);
          pA = { ...pt, x: pt.x + v1.x * c, y: pt.y + v1.y * c };
          pB = { x: pt.x + v2.x * c, y: pt.y + v2.y * c, type: pt.type || "G01" };
        } else {
          const r = parseFloat(currentR);
          const dot = v1.x * v2.x + v1.y * v2.y;
          const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
          const d = r / Math.tan(angle / 2);
          pA = { x: pt.x + v1.x * d, y: pt.y + v1.y * d, type: pt.type || "G01" };

          let nx = -v1.y,
              ny = v1.x;
          if (nx * v2.x + ny * v2.y < 0) {
            nx *= -1;
            ny *= -1;
          }
          const cx = pA.x + nx * r,
                cy = pA.y + ny * r;
          const pB_x = pt.x + v2.x * d,
                pB_y = pt.y + v2.y * d;

          const startAngle = Math.atan2(pA.y - cy, pA.x - cx);
          const endAngle = Math.atan2(pB_y - cy, pB_x - cx);
          let diff = endAngle - startAngle;
          while (diff > Math.PI) diff -= 2 * Math.PI;
          while (diff < -Math.PI) diff += 2 * Math.PI;
          const drawCCW = diff < 0;

          pB = {
            x: pB_x,
            y: pB_y,
            type: "arc",
            radius: r,
            ccw: diff > 0,
            drawCCW,
            cx,
            cy,
            startAngle,
            endAngle,
          };
        }

        if (i === 0) {
          closedCornerPA = pA; 
          res.push(pA, pB);
        } else if (i === pts.length - 1) {
          if (closedCornerPA) res.push({ ...closedCornerPA });
          else res.push(pA);
        } else {
          res.push(pA, pB);
        }
      } else {
        if (i === pts.length - 1 && isClosed && closedCornerPA) {
          res.push({ ...closedCornerPA });
        } else {
          res.push({ ...pt });
        }
      }
    }
    return res;
  };

  const visualPaths = useMemo(
    () => paths.map((p) => ({ ...p, points: getVisualPoints(p.points) })),
    [paths]
  );
  
  const activePath = useMemo(
    () => paths.find((p) => p.id === selectedPathId) || paths[paths.length - 1],
    [paths, selectedPathId]
  );

  const camPathPts = useMemo(() => {
    if (!activePath || !activePath.points) return [];
    if (selRange.pathId === activePath.id && selRange.p1 !== null && selRange.p2 !== null) {
      const min = Math.min(selRange.p1, selRange.p2);
      const max = Math.max(selRange.p1, selRange.p2);
      const sliced = activePath.points.slice(min, max + 1);
      return getVisualPoints(sliced);
    }
    return getVisualPoints(activePath.points);
  }, [activePath, selRange]);

  const getOffsetPoints = (pts, toolR, isInner) => {
    if (!pts || !Array.isArray(pts) || pts.length < 2) return [];
    const dir = isInner ? -1 : 1;
    return pts
      .map((pt, i) => {
        if (!pt) return null;
        if (pt.type === "arc" && pt.radius) {
          const mag = pt.ccw
            ? dir === 1
              ? -toolR
              : toolR
            : dir === 1
            ? toolR
            : -toolR;
          const newR = Math.max(0.001, pt.radius + mag);
          const newX = pt.cx + Math.cos(pt.endAngle) * newR;
          const newY = pt.cy + Math.sin(pt.endAngle) * newR;
          return { ...pt, radius: newR, x: newX, y: newY };
        }
        const p1 = i === 0 ? pt : pts[i - 1],
          p2 = i === 0 ? pts[1] : pt;
        if (!p1 || !p2) return { ...pt };
        const dx = p2.x - p1.x,
          dy = p2.y - p1.y,
          len = Math.hypot(dx, dy);
        if (len < 1e-5) return { ...pt };
        const newX = pt.x + (-dy / len) * toolR * dir;
        const newY = pt.y + (dx / len) * toolR * dir;
        return { ...pt, x: newX, y: newY };
      })
      .filter(Boolean);
  };

  const visualCompPaths = useMemo(
    () =>
      visualPaths.map((p) => ({
        ...p,
        points: getOffsetPoints(p.points, toolConfig.r, isInner),
      })),
    [visualPaths, toolConfig.r, isInner]
  );
  
  const camCompPts = useMemo(() => {
    return getOffsetPoints(camPathPts, toolConfig.r, isInner);
  }, [camPathPts, toolConfig.r, isInner]);

  const getTangentCircle = (mousePt) => {
    let best = null;
    let minD = 40 / cameraRef.current.zoom;
    paths.forEach((path) => {
      if (!path.points || !Array.isArray(path.points)) return;
      for (let i = 0; i < path.points.length - 1; i++) {
        const p1 = path.points[i],
          p2 = path.points[i + 1];
        if (!p1 || !p2) continue;
        const dx = p2.x - p1.x,
          dy = p2.y - p1.y,
          len = Math.hypot(dx, dy);
        if (len < 0.1) continue;
        const t = Math.max(
          0,
          Math.min(
            1,
            ((mousePt.x - p1.x) * dx + (mousePt.y - p1.y) * dy) / (len * len)
          )
        );
        const proj = { x: p1.x + t * dx, y: p1.y + t * dy };
        const dist = Math.hypot(mousePt.x - proj.x, mousePt.y - proj.y);
        if (dist < minD) {
          minD = dist;
          best = { cx: mousePt.x, cy: mousePt.y, r: dist };
        }
      }
    });
    return best;
  };

  const calcSCE = (p1, center, p3) => {
    if (!p1 || !center || !p3) return null;
    const r = Math.hypot(p1.x - center.x, p1.y - center.y);
    const startAngle = Math.atan2(p1.y - center.y, p1.x - center.x);
    const endAngle = Math.atan2(p3.y - center.y, p3.x - center.x);
    let diff = endAngle - startAngle;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    return {
      cx: center.x,
      cy: center.y,
      radius: r,
      startAngle,
      endAngle,
      ccw: diff > 0, 
      drawCCW: diff < 0, 
    };
  };

  const calcSER = (p1, p2, mouse) => {
    if (!p1 || !p2 || !mouse) return null;
    const d = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    const h = Math.hypot(mouse.x - mid.x, mouse.y - mid.y) || 1e-5;
    const r = h / 2 + (d * d) / (8 * h);
    const side =
      (p2.x - p1.x) * (mouse.y - p1.y) - (p2.y - p1.y) * (mouse.x - p1.x) > 0
        ? 1
        : -1;
    const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
    const cDist = Math.sqrt(Math.max(0, r * r - (d / 2) ** 2));
    const cx = mid.x + cDist * Math.sin(angle) * side,
      cy = mid.y - cDist * Math.cos(angle) * side;

    const startAngle = Math.atan2(p1.y - cy, p1.x - cx);
    const endAngle = Math.atan2(p2.y - cy, p2.x - cx);
    let diff = endAngle - startAngle;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;

    return {
      cx,
      cy,
      radius: r,
      startAngle,
      endAngle,
      ccw: diff > 0,
      drawCCW: diff < 0,
    };
  };

  const drawCross = (ctx, x, y, size, color, lw = 1) => {
    if (typeof x === "undefined" || typeof y === "undefined") return;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lw / cameraRef.current.zoom;
    ctx.beginPath();
    ctx.moveTo(x - size / cameraRef.current.zoom, y);
    ctx.lineTo(x + size / cameraRef.current.zoom, y);
    ctx.moveTo(x, y - size / cameraRef.current.zoom);
    ctx.lineTo(x, y + size / cameraRef.current.zoom);
    ctx.stroke();
    ctx.restore();
  };

  const solidifyFeatures = () => {
    if (!activePath) return;
    saveState();
    setPaths((prev) =>
      prev.map((path) =>
        path.id === activePath.id
          ? {
              ...path,
              points: getVisualPoints(path.points).map((p) => ({
                ...p,
                c: 0,
                r: 0,
              })),
            }
          : path
      )
    );
  };

  const handleZoomToFit = () => {
    const canvas = canvasRef.current;
    if (!canvas || !canvas.parentElement) return;

    const pWidth = canvas.parentElement.clientWidth;
    const pHeight = canvas.parentElement.clientHeight;

    let minX = -stock.length;
    let maxX = Number(stock.face) || 0;
    let minY = -stock.od / 2;
    let maxY = stock.od / 2;

    paths.forEach((p) => {
      if (!p.points) return;
      p.points.forEach((pt) => {
        if (pt.x < minX) minX = pt.x;
        if (pt.x > maxX) maxX = pt.x;
        if (pt.y < minY) minY = pt.y;
        if (pt.y > maxY) maxY = pt.y;
      });
    });

    const padding = isMobile ? 30 : 60;
    const boxWidth = maxX - minX || 1;
    const boxHeight = maxY - minY || 1;

    const zoomX = (pWidth - padding * 2) / boxWidth;
    const zoomY = (pHeight - padding * 2) / boxHeight;
    const newZoom = Math.max(0.01, Math.min(zoomX, zoomY, 150));

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;

    cameraRef.current.zoom = newZoom;
    cameraRef.current.x = pWidth / 2 - cx * newZoom;
    cameraRef.current.y = pHeight / 2 - cy * newZoom;
  };

  const genGCode = () => {
    if (!camPathPts || camPathPts.length < 2) {
      alert("請畫出或選定一條包含2點以上的加工路徑！");
      return;
    }
    const vPts = camPathPts;
    const startPt = vPts[0];
    const safeZ = Math.max(startPt.x, stock.face) + cam.safeDist;
    const safeX = isInner ? stock.id - cam.safeDist : stock.od + cam.safeDist;

    let g = `O2000 (CNC GEMINI MASTER)\nG50 S${cam.g50}\nT${
      toolConfig.code
    } M03 G96 S${cam.vc}\nG00 X${safeX.toFixed(3)} Z${safeZ.toFixed(3)} M08\n`;
    g += `G71 U${cam.doc} R0.5\nG71 P10 Q20 U${
      isInner ? -cam.allowX : cam.allowX
    } W${cam.allowZ} F${cam.feed}\nN10 G00 X${(-startPt.y * 2).toFixed(3)}\n`;
    vPts.forEach((pt, i) => {
      if (i === 0) return;
      const cmd =
        pt.type === "arc" ? (pt.ccw ? "G03" : "G02") : pt.type || "G01";
      g += `${cmd} X${(-pt.y * 2).toFixed(3)} Z${pt.x.toFixed(3)}${
        pt.type === "arc" ? ` R${pt.radius.toFixed(3)}` : ""
      }\n`;
    });
    g += `N20 G01 X${isInner ? stock.id - 2 : stock.od + 2}\nM30`;
    setGcode(g);
    
    if (isMobile && !isFullscreen) {
      setTimeout(() => {
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
      }, 100);
    }
  };

  const startSimulation = () => {
    if (interactionRef.current.sim.active) {
      interactionRef.current.sim.active = false;
      return;
    }

    if (!camCompPts || camCompPts.length < 2) {
      alert("請選取一條欲模擬的加工區段！");
      return;
    }

    let sPts = [];
    const activeCompPts = camCompPts;

    let flatPts = [];
    for (let i = 0; i < activeCompPts.length; i++) {
      let pt = activeCompPts[i];
      if (pt.type === "arc" && i > 0) {
        let steps = 15; 
        let aStart = pt.startAngle;
        let aEnd = pt.endAngle;
        if (pt.drawCCW && aStart > aEnd) aEnd += 2 * Math.PI;
        if (!pt.drawCCW && aStart < aEnd) aStart += 2 * Math.PI;

        for (let j = 1; j <= steps; j++) {
          let t = j / steps;
          let a = aStart + (aEnd - aStart) * t;
          flatPts.push({
            x: pt.cx + pt.radius * Math.cos(a),
            y: pt.cy + pt.radius * Math.sin(a),
          });
        }
      } else {
        flatPts.push(pt);
      }
    }

    const safeZ = Math.max(...flatPts.map((p) => p.x)) + cam.safeDist;
    const minZ = Math.min(...flatPts.map((p) => p.x)); 
    const startDia = isInner ? stock.id : stock.od;
    const safeY = -(startDia + (isInner ? -cam.safeDist * 2 : cam.safeDist * 2)) / 2;
    const startY = -startDia / 2;

    const targetY = isInner
      ? Math.max(...flatPts.map((p) => p.y || 0))
      : Math.min(...flatPts.map((p) => p.y || 0));

    sPts.push({ x: safeZ, y: safeY, type: "G00" });

    let currentY = startY;
    let passes = 0;
    const maxPasses = 300;

    while (
      (isInner ? currentY < targetY : currentY > targetY) &&
      passes < maxPasses
    ) {
      currentY += isInner ? cam.doc / 2 : -cam.doc / 2;

      if ((isInner && currentY > targetY) || (!isInner && currentY < targetY)) {
        currentY = targetY;
      }

      let intersectZs = [];
      for (let i = 0; i < flatPts.length - 1; i++) {
        let p1 = flatPts[i], p2 = flatPts[i + 1];
        if (!p1 || !p2) continue;

        const minY = Math.min(p1.y, p2.y);
        const maxY = Math.max(p1.y, p2.y);

        if (currentY >= minY && currentY <= maxY) {
          if (p1.y !== p2.y) {
            const z = p1.x + ((currentY - p1.y) / (p2.y - p1.y)) * (p2.x - p1.x);
            intersectZs.push(z);
          } else {
            intersectZs.push(Math.max(p1.x, p2.x));
          }
        }
      }

      let endZ = minZ; 
      if (intersectZs.length > 0) {
        endZ = Math.max(...intersectZs);
      }

      if (endZ < safeZ) {
        sPts.push({ x: safeZ, y: currentY, type: "G00" }); 
        sPts.push({ x: endZ, y: currentY, type: "G01" });  
        const retractDir = isInner ? -0.5 : 0.5;
        sPts.push({ x: endZ + 0.5, y: currentY + retractDir, type: "G01" });
        sPts.push({ x: safeZ, y: currentY + retractDir, type: "G00" }); 
      }
      passes++;
    }

    sPts.push({ x: safeZ, y: activeCompPts[0].y, type: "G00" });
    activeCompPts.forEach((pt) => sPts.push({ ...pt, type: pt.type || "G01" }));
    
    const lastPt = activeCompPts[activeCompPts.length - 1];
    sPts.push({ 
      x: lastPt.x + 1, 
      y: lastPt.y + (isInner ? -1 : 1), 
      type: "G01" 
    });
    sPts.push({ x: safeZ, y: safeY, type: "G00" });

    interactionRef.current.sim = { active: true, progress: 0, pts: sPts };
    
    if (isMobile && !isFullscreen) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  // --- 畫布渲染 ---
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let animationFrameId;

    if (paths.length === 0 && stock.od > 0 && stock.length > 0 && !interactionRef.current.initialZoomed) {
      handleZoomToFit();
      interactionRef.current.initialZoomed = true;
    }

    const render = () => {
      canvas.width = canvas.parentElement.clientWidth;
      canvas.height = canvas.parentElement.clientHeight;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.translate(cameraRef.current.x, cameraRef.current.y);
      ctx.scale(cameraRef.current.zoom, cameraRef.current.zoom);

      if (bgImage) {
        ctx.globalAlpha = bgOpacity;
        ctx.drawImage(bgImage, -200, -200, 400, 400);
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      ctx.fillRect(
        -stock.length,
        -stock.od / 2,
        stock.length + Number(stock.face),
        (stock.od - stock.id) / 2
      );

      ctx.strokeStyle = "#333";
      ctx.lineWidth = 1 / cameraRef.current.zoom;
      ctx.beginPath();
      for (let i = -500; i <= 500; i += 50) {
        ctx.moveTo(i, -500);
        ctx.lineTo(i, 500);
        ctx.moveTo(-500, i);
        ctx.lineTo(500, i);
      }
      ctx.stroke();
      ctx.strokeStyle = "#ff5722";
      ctx.beginPath();
      ctx.moveTo(0, -500);
      ctx.lineTo(0, 500);
      ctx.stroke();
      ctx.strokeStyle = "#007bff";
      ctx.beginPath();
      ctx.moveTo(-500, 0);
      ctx.lineTo(500, 0);
      ctx.stroke();
      drawCross(ctx, 0, 0, 20, "red", 2);

      visualPaths.forEach((p, idx) => {
        if (!p?.points || !Array.isArray(p.points)) return;
        const isActive = p.id === activePath?.id;
        const isHovered = p.id === interactionRef.current.hoveredPathId && mode === "SELECT";
        
        const hasSubSelection = isActive && selRange.p1 !== null && selRange.p2 !== null;

        ctx.lineWidth = (isActive || isHovered) ? 2.5 / cameraRef.current.zoom : 1.5 / cameraRef.current.zoom;
        ctx.strokeStyle = isActive ? (hasSubSelection ? "#1b401b" : "#00ff00") : isHovered ? "#bfffbf" : "#4a824a";
        
        ctx.beginPath();
        p.points.forEach((pt, i) => {
          if (!pt || typeof pt.x === "undefined" || typeof pt.y === "undefined") return;
          if (i === 0) ctx.moveTo(pt.x, pt.y);
          else if (pt.type === "arc") ctx.arc(pt.cx, pt.cy, pt.radius, pt.startAngle, pt.endAngle, pt.drawCCW !== undefined ? pt.drawCCW : !pt.ccw);
          else ctx.lineTo(pt.x, pt.y);
        });
        ctx.stroke();

        const cPts = visualCompPaths[idx]?.points;
        if (cPts && Array.isArray(cPts) && cPts.length > 0 && !interactionRef.current.sim.active) {
          ctx.beginPath();
          ctx.strokeStyle = isActive ? (hasSubSelection ? "rgba(0, 255, 255, 0.1)" : toolConfig.color) : "rgba(0, 255, 255, 0.2)";
          ctx.setLineDash([4 / cameraRef.current.zoom]);
          cPts.forEach((pt, i) => {
            if (!pt || typeof pt.x === "undefined" || typeof pt.y === "undefined") return;
            if (i === 0) ctx.moveTo(pt.x, pt.y);
            else if (pt.type === "arc" && pt.radius) ctx.arc(pt.cx, pt.cy, pt.radius, pt.startAngle, pt.endAngle, pt.drawCCW !== undefined ? pt.drawCCW : !pt.ccw);
            else ctx.lineTo(pt.x, pt.y);
          });
          ctx.stroke();
          ctx.setLineDash([]);
        }
      });

      // 🔥 渲染橡皮擦選取的欲刪除線段
      if (mode === "ERASE" && interactionRef.current.hoveredSegment) {
        const hs = interactionRef.current.hoveredSegment;
        const p = paths[hs.pathIdx];
        if (p && p.points && p.points[hs.segIdx] && p.points[hs.segIdx + 1]) {
          const pt1 = p.points[hs.segIdx];
          const pt2 = p.points[hs.segIdx + 1];
          ctx.save();
          ctx.lineWidth = 5 / cameraRef.current.zoom;
          ctx.strokeStyle = "#ff4444"; // 刪除提示色(紅)
          ctx.beginPath();
          ctx.moveTo(pt1.x, pt1.y);
          // 為了準確反白，這裡直接用線段相連表示
          ctx.lineTo(pt2.x, pt2.y);
          ctx.stroke();
          ctx.restore();
        }
      }

      if (activePath && camPathPts.length > 0) {
        const hasSubSelection = selRange.pathId === activePath.id && selRange.p1 !== null && selRange.p2 !== null;
        if (hasSubSelection) {
          ctx.lineWidth = 3 / cameraRef.current.zoom;
          ctx.strokeStyle = "#00ff00"; 
          ctx.beginPath();
          camPathPts.forEach((pt, i) => {
            if (i === 0) ctx.moveTo(pt.x, pt.y);
            else if (pt.type === "arc") ctx.arc(pt.cx, pt.cy, pt.radius, pt.startAngle, pt.endAngle, pt.drawCCW !== undefined ? pt.drawCCW : !pt.ccw);
            else ctx.lineTo(pt.x, pt.y);
          });
          ctx.stroke();

          if (camCompPts.length > 0 && !interactionRef.current.sim.active) {
            ctx.beginPath();
            ctx.strokeStyle = toolConfig.color;
            ctx.setLineDash([4 / cameraRef.current.zoom]);
            camCompPts.forEach((pt, i) => {
              if (i === 0) ctx.moveTo(pt.x, pt.y);
              else if (pt.type === "arc" && pt.radius) ctx.arc(pt.cx, pt.cy, pt.radius, pt.startAngle, pt.endAngle, pt.drawCCW !== undefined ? pt.drawCCW : !pt.ccw);
              else ctx.lineTo(pt.x, pt.y);
            });
            ctx.stroke();
            ctx.setLineDash([]);
          }
        }
      }

      paths.forEach((p) => {
        if (p.id !== activePath?.id || !p.points) return;
        const isClosed = p.points.length > 2 && Math.hypot(p.points[0].x - p.points[p.points.length-1].x, p.points[0].y - p.points[p.points.length-1].y) < 0.001;
        
        p.points.forEach((pt, i) => {
          if (!pt || typeof pt.x === "undefined") return;
          if (isClosed && i === p.points.length - 1) return; 

          const isSelectedEndPt = selRange.pathId === p.id && (selRange.p1 === i || selRange.p2 === i);
          
          drawCross(ctx, pt.x, pt.y, isSelectedEndPt ? 10 : 5, isSelectedEndPt ? "#ffeb3b" : "#fff", isSelectedEndPt ? 2 : 1);
          
          if (pt.c || pt.r) {
            ctx.fillStyle = "#ff00ff";
            ctx.font = `${12 / cameraRef.current.zoom}px Arial`;
            ctx.fillText(
              pt.c ? `C${pt.c}` : `R${pt.r}`,
              pt.x + 5 / cameraRef.current.zoom,
              pt.y - 5 / cameraRef.current.zoom
            );
          }
        });
      });

      const cur = interactionRef.current.currentPt;
      if (cur && typeof cur.x !== "undefined" && typeof cur.y !== "undefined") {
        if (mode === "DRAW_CIRCLE") {
          if (circleSubMode === "TAN") {
            const tangent = getTangentCircle(cur);
            interactionRef.current.tangentCircle = tangent;
            if (tangent) {
              ctx.setLineDash([5 / cameraRef.current.zoom]);
              ctx.strokeStyle = "#ffeb3b";
              ctx.beginPath();
              ctx.arc(tangent.cx, tangent.cy, tangent.r, 0, Math.PI * 2);
              ctx.stroke();
              ctx.setLineDash([]);
            }
          } else if (
            circleSubMode === "CEN" &&
            interactionRef.current.circleStart
          ) {
            const r = Math.hypot(
              cur.x - interactionRef.current.circleStart.x,
              cur.y - interactionRef.current.circleStart.y
            );
            ctx.strokeStyle = "rgba(0,255,0,0.5)";
            ctx.beginPath();
            ctx.arc(
              interactionRef.current.circleStart.x,
              interactionRef.current.circleStart.y,
              r,
              0,
              Math.PI * 2
            );
            ctx.stroke();
          }
        }

        if (mode === "TRIM" && interactionRef.current.trimPath.length > 0) {
          ctx.strokeStyle = "#ff4444";
          ctx.lineWidth = 2 / cameraRef.current.zoom;
          ctx.beginPath();
          interactionRef.current.trimPath.forEach((p, i) => {
            if (p && typeof p.x !== "undefined")
              i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
          });
          ctx.stroke();
        }

        let end = cur;
        if (
          isOrtho &&
          mode === "DRAW_LINE" &&
          interactionRef.current.continuous &&
          activePath?.points &&
          !interactionRef.current.isSnapped
        ) {
          const last = activePath.points[activePath.points.length - 1];
          if (last && typeof last.x !== "undefined") {
            end =
              Math.abs(cur.x - last.x) > Math.abs(cur.y - last.y)
                ? { x: cur.x, y: last.y }
                : { x: last.x, y: cur.y };
          }
        }

        if (
          mode === "DRAW_LINE" &&
          interactionRef.current.continuous &&
          activePath?.points
        ) {
          const lastPt = activePath.points[activePath.points.length - 1];
          if (lastPt && typeof lastPt.x !== "undefined") {
            ctx.save();
            ctx.setLineDash([5 / cameraRef.current.zoom]);
            ctx.strokeStyle =
              lineMode === "G00" ? "rgba(255,0,0,0.5)" : "rgba(0,255,0,0.5)";
            ctx.beginPath();
            ctx.moveTo(lastPt.x, lastPt.y);
            ctx.lineTo(end.x, end.y);
            ctx.stroke();
            ctx.restore();
          }
        } else if (mode === "DRAW_ARC") {
          const aps = interactionRef.current.arcPts;
          ctx.save();
          ctx.setLineDash([5 / cameraRef.current.zoom]);
          ctx.strokeStyle = "rgba(0,255,0,0.5)";
          if (aps.length === 1 && aps[0]) {
            ctx.beginPath();
            ctx.moveTo(aps[0].x, aps[0].y);
            ctx.lineTo(end.x, end.y);
            ctx.stroke();
          } else if (aps.length === 2 && aps[0] && aps[1]) {
            try {
              const a =
                arcSubMode === "SCE"
                  ? calcSCE(aps[0], aps[1], end)
                  : calcSER(aps[0], aps[1], end);
              if (a && a.radius) {
                ctx.beginPath();
                ctx.arc(a.cx, a.cy, a.radius, a.startAngle, a.endAngle, a.ccw);
                ctx.stroke();
              }
            } catch (e) {}
          }
          ctx.restore();
        }

        const c =
          mode === "CHAMFER"
            ? "#ff00ff"
            : interactionRef.current.isSnapped
            ? "#ffeb3b"
            : mode === "SELECT"
            ? "#0dcaf0"
            : "#00ff00";
        ctx.strokeStyle = c;
        ctx.lineWidth = 1 / cameraRef.current.zoom;
        ctx.beginPath();
        ctx.moveTo(cur.x - 15 / cameraRef.current.zoom, cur.y);
        ctx.lineTo(cur.x + 15 / cameraRef.current.zoom, cur.y);
        ctx.moveTo(cur.x, cur.y - 15 / cameraRef.current.zoom);
        ctx.lineTo(cur.x, cur.y + 15 / cameraRef.current.zoom);
        ctx.stroke();

        const zDom = document.getElementById("coordZ");
        const xDom = document.getElementById("coordX");
        if (zDom)
          zDom.innerText = interactionRef.current.isSnapped
            ? "0.000"
            : end.x.toFixed(3);
        if (xDom)
          xDom.innerText = interactionRef.current.isSnapped
            ? "0.000"
            : (-end.y * 2).toFixed(3);
      }

      if (interactionRef.current.sim.active) {
        let sim = interactionRef.current.sim;
        sim.progress += 0.4; 
        if (sim.progress >= sim.pts.length - 1) {
          sim.progress = sim.pts.length - 1;
          sim.active = false;
        }

        const idx = Math.floor(sim.progress);
        const nextIdx = Math.min(idx + 1, sim.pts.length - 1);
        const t = sim.progress - idx;
        const pt1 = sim.pts[idx];
        const pt2 = sim.pts[nextIdx];
        if (pt1 && pt2 && typeof pt1.x !== "undefined") {
          const curX = pt1.x + (pt2.x - pt1.x) * t;
          const curY = pt1.y + (pt2.y - pt1.y) * t;
          ctx.lineWidth = 2 / cameraRef.current.zoom;
          for (let i = 1; i <= idx; i++) {
            if (!sim.pts[i] || !sim.pts[i - 1]) continue;
            ctx.strokeStyle =
              sim.pts[i].type === "G00" ? "#ff4444" : toolConfig.color;
            ctx.setLineDash(
              sim.pts[i].type === "G00" ? [3 / cameraRef.current.zoom] : []
            );
            ctx.beginPath();
            ctx.moveTo(sim.pts[i - 1].x, sim.pts[i - 1].y);
            ctx.lineTo(sim.pts[i].x, sim.pts[i].y);
            ctx.stroke();
          }
          ctx.strokeStyle = pt2.type === "G00" ? "#ff4444" : toolConfig.color;
          ctx.setLineDash(
            pt2.type === "G00" ? [3 / cameraRef.current.zoom] : []
          );
          ctx.beginPath();
          ctx.moveTo(pt1.x, pt1.y);
          ctx.lineTo(curX, curY);
          ctx.stroke();
          ctx.setLineDash([]);

          ctx.fillStyle = toolConfig.color;
          ctx.beginPath();
          const aRad = (toolConfig.angle / 2) * (Math.PI / 180);
          const dirY = isInner ? -1 : 1;
          const hL = 20 / cameraRef.current.zoom;
          ctx.moveTo(curX, curY);
          ctx.arc(curX, curY, toolConfig.r, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.moveTo(curX, curY);
          ctx.lineTo(
            curX + Math.cos(aRad) * hL,
            curY + Math.sin(aRad) * hL * dirY
          );
          ctx.lineTo(
            curX + Math.cos(aRad) * hL + 15 / cameraRef.current.zoom,
            curY + Math.sin(aRad) * hL * dirY
          );
          ctx.lineTo(
            curX + Math.cos(aRad) * hL + 15 / cameraRef.current.zoom,
            curY - Math.sin(aRad) * hL * dirY
          );
          ctx.lineTo(
            curX + Math.cos(aRad) * hL,
            curY - Math.sin(aRad) * hL * dirY
          );
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = "rgba(100, 100, 100, 0.8)";
          ctx.fillRect(
            curX + Math.cos(aRad) * hL,
            curY - (10 * dirY) / cameraRef.current.zoom,
            30 / cameraRef.current.zoom,
            (20 * dirY) / cameraRef.current.zoom
          );
        }
      }
      ctx.restore();
      
      animationFrameId = requestAnimationFrame(render);
    };
    render();
    
    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [
    visualPaths,
    visualCompPaths,
    activePath,
    camPathPts,
    camCompPts,
    selRange,
    stock,
    mode,
    circleSubMode,
    isOrtho,
    lineMode,
    arcSubMode,
    toolConfig,
    isInner,
    isMobile,
    isFullscreen 
  ]);

  const handlePointerDown = (clientX, clientY, button = 0) => {
    if (button === 2) {
      interactionRef.current.continuous = false;
      interactionRef.current.circleStart = null;
      interactionRef.current.arcPts = [];
      setPaths((p) => [...p]);
      return;
    }
    const rect = canvasRef.current.getBoundingClientRect();
    const rawPt = {
      x: (clientX - rect.left - cameraRef.current.x) / cameraRef.current.zoom,
      y: (clientY - rect.top - cameraRef.current.y) / cameraRef.current.zoom,
    };

    let snapPt = rawPt;
    let isSnapped = false;
    if (Math.hypot(rawPt.x, rawPt.y) < (isMobile ? 20 : 12) / cameraRef.current.zoom) {
      snapPt = { x: 0, y: 0 };
      isSnapped = true;
    }
    paths.forEach((p) => {
      if (p.points)
        p.points.forEach((pt) => {
          if (
            pt &&
            Math.hypot(rawPt.x - pt.x, rawPt.y - pt.y) <
              (isMobile ? 20 : 12) / cameraRef.current.zoom
          ) {
            snapPt = pt;
            isSnapped = true;
          }
        });
    });

    if (mode === "DRAW_CIRCLE") {
      if (circleSubMode === "TAN") {
        const tangent = interactionRef.current.tangentCircle;
        if (tangent) {
          saveState();
          const pts = [];
          for (let a = 0; a <= 360; a += 5)
            pts.push({
              x: tangent.cx + Math.cos((a * Math.PI) / 180) * tangent.r,
              y: tangent.cy + Math.sin((a * Math.PI) / 180) * tangent.r,
              type: "G01",
              c: 0,
              r: 0,
            });
          setPaths((prev) => [...prev, { id: Date.now(), points: pts }]);
        }
      } else if (circleSubMode === "CEN") {
        if (!interactionRef.current.circleStart) {
          interactionRef.current.circleStart = snapPt;
        } else {
          saveState();
          const r = Math.hypot(
            snapPt.x - interactionRef.current.circleStart.x,
            snapPt.y - interactionRef.current.circleStart.y
          );
          if (r > 0.01) {
            const cx = interactionRef.current.circleStart.x,
              cy = interactionRef.current.circleStart.y;
            const pts = [];
            for (let a = 0; a <= 360; a += 5)
              pts.push({
                x: cx + Math.cos((a * Math.PI) / 180) * r,
                y: cy + Math.sin((a * Math.PI) / 180) * r,
                type: "G01",
                c: 0,
                r: 0,
              });
            setPaths((prev) => [...prev, { id: Date.now(), points: pts }]);
          }
          interactionRef.current.circleStart = null;
        }
      }
      return;
    }

    if (mode === "PAN") {
      interactionRef.current.isDragging = true;
      interactionRef.current.lastMouse = { x: clientX, y: clientY };
    } else if (mode === "SELECT") {
      const hId = interactionRef.current.hoveredPathId;
      const hIdx = interactionRef.current.hoveredPtIdx;
      if (hId !== null && hIdx !== null) {
        setSelectedPathId(hId);
        setSelRange((prev) => {
          if (prev.pathId !== hId) {
            return { pathId: hId, p1: hIdx, p2: null }; 
          } else if (prev.p1 !== null && prev.p2 !== null) {
            return { pathId: hId, p1: hIdx, p2: null }; 
          } else if (prev.p1 !== null && prev.p2 === null) {
            if (prev.p1 === hIdx) return { pathId: hId, p1: null, p2: null }; 
            return { ...prev, p2: hIdx }; 
          }
          return prev;
        });
      } else {
        setSelectedPathId(null);
        setSelRange({ pathId: null, p1: null, p2: null });
      }
    } else if (mode === "TRIM") {
      interactionRef.current.isDragging = true;
      interactionRef.current.trimPath = [rawPt];
    } else if (mode === "ERASE") {
      // 🔥 橡皮擦：刪除選中線段
      const hs = interactionRef.current.hoveredSegment;
      if (hs) {
        saveState();
        setPaths((prev) => {
          const n = JSON.parse(JSON.stringify(prev));
          const targetPath = n[hs.pathIdx];
          const pts = targetPath.points;

          const p1 = pts.slice(0, hs.segIdx + 1);
          const p2 = pts.slice(hs.segIdx + 1);

          n.splice(hs.pathIdx, 1);
          // 若拆分後的線段還有兩點以上，就保留下來
          if (p1.length > 1) n.push({ id: Date.now() + 1, points: p1 });
          if (p2.length > 1) n.push({ id: Date.now() + 2, points: p2 });

          return n;
        });
        interactionRef.current.hoveredSegment = null;
      }
    } else if (mode === "CHAMFER") {
      const hc = interactionRef.current.hoveredCorner;
      if (hc) {
        saveState();
        setPaths((prev) => {
          const n = JSON.parse(JSON.stringify(prev));
          const pts = n[hc.pIdx].points;
          pts[hc.ptIdx][chamferType] = chamferVal;
          
          const isClosed = pts.length > 2 && Math.hypot(pts[0].x - pts[pts.length-1].x, pts[0].y - pts[pts.length-1].y) < 0.001;
          if (isClosed && (hc.ptIdx === 0 || hc.ptIdx === pts.length - 1)) {
            pts[0][chamferType] = chamferVal;
            pts[pts.length - 1][chamferType] = chamferVal;
          }
          return n;
        });
      }
    } else if (mode === "DRAW_LINE") {
      saveState();
      let end = snapPt;
      let autoJoined = false;
      if (!interactionRef.current.continuous && isSnapped) {
        setPaths((prev) => {
          let n = [...prev];
          for (let i = 0; i < n.length; i++) {
            if (!n[i].points || n[i].points.length === 0) continue;
            const lastPt = n[i].points[n[i].points.length - 1];
            if (
              lastPt &&
              Math.hypot(end.x - lastPt.x, end.y - lastPt.y) < 0.001
            ) {
              setSelectedPathId(n[i].id);
              autoJoined = true;
              break;
            }
          }
          return n;
        });
        if (autoJoined) {
          interactionRef.current.continuous = true;
          return;
        }
      }
      if (
        isOrtho &&
        interactionRef.current.continuous &&
        activePath &&
        !isSnapped
      ) {
        const last = activePath.points[activePath.points.length - 1];
        if (last)
          end =
            Math.abs(snapPt.x - last.x) > Math.abs(snapPt.y - last.y)
              ? { x: snapPt.x, y: last.y }
              : { x: last.x, y: snapPt.y };
      }
      setPaths((prev) => {
        let n = [...prev];
        if (!interactionRef.current.continuous || n.length === 0) {
          const id = Date.now();
          n.push({ id, points: [{ ...end, type: lineMode, c: 0, r: 0 }] });
          setSelectedPathId(id);
        } else {
          const idx = n.findIndex((p) => p.id === activePath?.id);
          if (idx !== -1)
            n[idx].points.push({ ...end, type: lineMode, c: 0, r: 0 });
        }
        return n;
      });
      interactionRef.current.continuous = true;
    } else if (mode === "DRAW_ARC") {
      let aps = interactionRef.current.arcPts;
      if (aps.length === 0 && interactionRef.current.continuous && activePath)
        aps.push(activePath.points[activePath.points.length - 1]);
      aps.push(snapPt);
      if (aps.length === 3) {
        saveState();
        const a =
          arcSubMode === "SCE"
            ? calcSCE(aps[0], aps[1], aps[2])
            : calcSER(aps[0], aps[1], aps[2]);
        if (a) {
          setPaths((prev) => {
            let n = [...prev];
            const pathIdx = n.findIndex((p) => p.id === activePath?.id);
            if (pathIdx === -1 || !interactionRef.current.continuous) {
              const newId = Date.now();
              n.push({
                id: newId,
                points: [aps[0], { ...aps[2], type: "arc", ...a, c: 0, r: 0 }],
              });
              setSelectedPathId(newId);
            } else {
              n[pathIdx].points.push({
                ...aps[2],
                type: "arc",
                ...a,
                c: 0,
                r: 0,
              });
            }
            return n;
          });
          interactionRef.current.continuous = true;
          setMode("DRAW_LINE");
        }
        interactionRef.current.arcPts = [];
      } else {
        interactionRef.current.arcPts = aps;
      }
    }
  };

  const handlePointerMove = (clientX, clientY) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const rawPt = {
      x: (clientX - rect.left - cameraRef.current.x) / cameraRef.current.zoom,
      y: (clientY - rect.top - cameraRef.current.y) / cameraRef.current.zoom,
    };

    let snapPt = rawPt;
    let isSnapped = false;
    if (Math.hypot(rawPt.x, rawPt.y) < (isMobile ? 20 : 12) / cameraRef.current.zoom) {
      snapPt = { x: 0, y: 0 };
      isSnapped = true;
    }
    paths.forEach((p) => {
      if (p.points)
        p.points.forEach((pt) => {
          if (
            pt &&
            Math.hypot(rawPt.x - pt.x, rawPt.y - pt.y) <
              (isMobile ? 20 : 12) / cameraRef.current.zoom
          ) {
            snapPt = pt;
            isSnapped = true;
          }
        });
    });

    interactionRef.current.currentPt = snapPt;
    interactionRef.current.isSnapped = isSnapped;

    if (mode === "SELECT") {
      let minD = (isMobile ? 30 : 20) / cameraRef.current.zoom,
        foundId = null,
        foundPtIdx = null;
      paths.forEach((p) => {
        if (p.points) {
          p.points.forEach((pt, idx) => {
            if (pt && Math.hypot(rawPt.x - pt.x, rawPt.y - pt.y) < minD) {
              minD = Math.hypot(rawPt.x - pt.x, rawPt.y - pt.y);
              foundId = p.id;
              foundPtIdx = idx;
            }
          });
        }
      });
      interactionRef.current.hoveredPathId = foundId;
      interactionRef.current.hoveredPtIdx = foundPtIdx;
    } else if (mode === "ERASE") {
      // 🔥 橡皮擦：判斷游標最靠近哪一條線段
      let minD = (isMobile ? 30 : 20) / cameraRef.current.zoom;
      let found = null;

      const getDistToSegment = (p, v, w) => {
        const l2 = (v.x - w.x)**2 + (v.y - w.y)**2;
        if (l2 === 0) return Math.hypot(p.x - v.x, p.y - v.y);
        let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
        t = Math.max(0, Math.min(1, t));
        return Math.hypot(p.x - (v.x + t * (w.x - v.x)), p.y - (v.y + t * (w.y - v.y)));
      };

      paths.forEach((p, pIdx) => {
        if (!p.points) return;
        const pts = p.points;
        for (let i = 0; i < pts.length - 1; i++) {
          if (!pts[i] || !pts[i+1]) continue;
          // 將圓弧視為一直線來做點選判定（足以應付大多數點選需求）
          const d = getDistToSegment(rawPt, pts[i], pts[i+1]);
          if (d < minD) {
            minD = d;
            found = { pathIdx: pIdx, segIdx: i };
          }
        }
      });
      interactionRef.current.hoveredSegment = found;
    } else {
      interactionRef.current.hoveredPathId = null;
      interactionRef.current.hoveredPtIdx = null;
      interactionRef.current.hoveredSegment = null;
    }

    if (mode === "CHAMFER") {
      let minD = (isMobile ? 30 : 20) / cameraRef.current.zoom,
        found = null;
      paths.forEach((p, pIdx) => {
        if (!p.points) return;
        const isClosed = p.points.length > 2 && Math.hypot(p.points[0].x - p.points[p.points.length-1].x, p.points[0].y - p.points[p.points.length-1].y) < 0.001;
        
        for (let i = 0; i < p.points.length; i++) {
          if (!isClosed && (i === 0 || i === p.points.length - 1)) continue;
          const pt = p.points[i];
          if (pt && Math.hypot(rawPt.x - pt.x, rawPt.y - pt.y) < minD) {
            minD = Math.hypot(rawPt.x - pt.x, rawPt.y - pt.y);
            found = { pIdx, ptIdx: i };
          }
        }
      });
      interactionRef.current.hoveredCorner = found;
    } else {
      interactionRef.current.hoveredCorner = null;
    }

    if (interactionRef.current.isDragging) {
      if (mode === "PAN") {
        cameraRef.current.x += clientX - interactionRef.current.lastMouse.x;
        cameraRef.current.y += clientY - interactionRef.current.lastMouse.y;
        interactionRef.current.lastMouse = { x: clientX, y: clientY };
      } else if (mode === "TRIM") {
        interactionRef.current.trimPath.push(rawPt);
      }
    }
  };

  const handlePointerUp = () => {
    if (mode === "TRIM" && interactionRef.current.trimPath.length > 1) {
      saveState();
      const tPath = interactionRef.current.trimPath;
      setPaths((prev) => {
        const allSegs = [];
        prev.forEach((path) => {
          if (path.points)
            for (let i = 0; i < path.points.length - 1; i++)
              if (path.points[i] && path.points[i + 1])
                allSegs.push({ A: path.points[i], B: path.points[i + 1] });
        });

        let newPaths = [];
        prev.forEach((path) => {
          if (!path.points) return;
          let cur = [];
          for (let i = 0; i < path.points.length - 1; i++) {
            const p1 = path.points[i],
              p2 = path.points[i + 1];
            if (!p1 || !p2) continue;
            let inters = [];
            allSegs.forEach((seg) => {
              const I = checkIntersect(p1, p2, seg.A, seg.B, false);
              if (I) inters.push(I);
            });
            inters.sort(
              (a, b) =>
                Math.hypot(a.x - p1.x, a.y - p1.y) -
                Math.hypot(b.x - p1.x, b.y - p1.y)
            );

            let uniqueInters = [];
            inters.forEach((I) => {
              if (
                uniqueInters.length === 0 ||
                Math.hypot(
                  I.x - uniqueInters[uniqueInters.length - 1].x,
                  I.y - uniqueInters[uniqueInters.length - 1].y
                ) > 0.001
              )
                uniqueInters.push(I);
            });

            let microPts = [p1, ...uniqueInters, p2];
            for (let k = 0; k < microPts.length - 1; k++) {
              const m1 = microPts[k],
                m2 = microPts[k + 1];
              let cut = false;
              for (let j = 0; j < tPath.length - 1; j++)
                if (checkIntersect(m1, m2, tPath[j], tPath[j + 1], true)) {
                  cut = true;
                  break;
                }

              if (cut) {
                if (cur.length > 0) {
                  cur.push({ ...m1, type: p2.type });
                  newPaths.push({ id: Math.random(), points: cur });
                  cur = [];
                }
              } else {
                if (cur.length === 0)
                  cur.push({
                    ...m1,
                    type: k === 0 ? p1.type : p2.type,
                    c: p1.c,
                    r: p1.r,
                  });
                if (k === microPts.length - 2)
                  cur.push({ ...m2, type: p2.type, c: 0, r: 0 });
              }
            }
          }
          if (cur.length > 1) newPaths.push({ id: Math.random(), points: cur });
        });
        return newPaths
          .map((p) => ({
            ...p,
            points: p.points.filter(
              (pt, idx, arr) =>
                pt &&
                (idx === 0 ||
                  Math.hypot(pt.x - arr[idx - 1].x, pt.y - arr[idx - 1].y) >
                    0.001)
            ),
          }))
          .filter((p) => p.points && p.points.length > 1);
      });
    }
    interactionRef.current.isDragging = false;
    interactionRef.current.trimPath = [];
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: isMobile && !isFullscreen ? "column" : "row",
        width: "100vw",
        height: "100vh",
        backgroundColor: "#1e1e1e",
        color: "white",
        overflow: isMobile ? "auto" : "hidden",
      }}
    >
      <div style={{ 
        flexGrow: 1, 
        position: "relative",
        height: isFullscreen ? "100vh" : (isMobile ? "55vh" : "100vh"),
        width: isFullscreen ? "100vw" : "auto",
        minHeight: isMobile && !isFullscreen ? "350px" : "auto" 
      }}>
        <canvas
          ref={canvasRef}
          style={{
            display: "block",
            width: "100%",
            height: "100%",
            cursor: "none",
            touchAction: "none", 
          }}
          onMouseDown={(e) => handlePointerDown(e.clientX, e.clientY, e.button)}
          onMouseMove={(e) => handlePointerMove(e.clientX, e.clientY)}
          onMouseUp={handlePointerUp}
          onMouseLeave={handlePointerUp}
          onTouchStart={(e) => {
            if (e.touches.length === 1) {
              const touch = e.touches[0];
              handlePointerDown(touch.clientX, touch.clientY, 0);
            } else if (e.touches.length === 2) {
              const t1 = e.touches[0];
              const t2 = e.touches[1];
              interactionRef.current.initialPinchDist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
              interactionRef.current.initialZoom = cameraRef.current.zoom;
            }
          }}
          onTouchMove={(e) => {
            if (e.touches.length === 1) {
              const touch = e.touches[0];
              handlePointerMove(touch.clientX, touch.clientY);
            } else if (e.touches.length === 2 && interactionRef.current.initialPinchDist) {
              const t1 = e.touches[0];
              const t2 = e.touches[1];
              const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
              const scale = dist / interactionRef.current.initialPinchDist;
              cameraRef.current.zoom = Math.max(0.01, Math.min(interactionRef.current.initialZoom * scale, 150));
            }
          }}
          onTouchEnd={(e) => {
            interactionRef.current.initialPinchDist = null;
            handlePointerUp();
          }}
          onWheel={(e) => {
            const z = e.deltaY > 0 ? 0.85 : 1.15;
            cameraRef.current.zoom = Math.max(0.01, Math.min(cameraRef.current.zoom * z, 150));
          }}
          onContextMenu={(e) => e.preventDefault()}
        />

        <div
          style={{
            position: "absolute",
            top: 5,
            left: 5,
            display: "flex",
            gap: "4px",
            background: "rgba(0,0,0,0.8)",
            padding: "8px",
            borderRadius: "8px",
            flexWrap: "wrap",
            maxWidth: isMobile ? "95%" : "85%",
            maxHeight: isMobile ? "150px" : "auto",
            overflowY: "auto",
          }}
        >
          <button onClick={() => { setIsFullscreen(!isFullscreen); setTimeout(handleZoomToFit, 50); }} style={{ background: isFullscreen ? "#e83e8c" : "#17a2b8", color: "#fff", border: "none", padding: "6px 10px", borderRadius: "4px", cursor: "pointer", fontWeight: "bold", fontSize: isMobile ? "11px" : "13px" }}>
            {isFullscreen ? "🔲 縮回" : "🔲 滿屏"}
          </button>
          
          <button onClick={handleUndo} style={{ background: "#ff9800", border: "none", padding: "6px 10px", borderRadius: "4px", fontWeight: "bold", cursor: "pointer", fontSize: isMobile ? "11px" : "13px" }}>
            ↩ 復原
          </button>

          <div style={{ display: "flex", gap: "2px", background: "#333", padding: "2px", borderRadius: "4px" }}>
            <button onClick={() => setMode("SELECT")} style={{ background: mode === "SELECT" ? "#0dcaf0" : "#444", color: mode === "SELECT" ? "#000" : "#fff", border: "none", padding: "6px 10px", borderRadius: "4px", cursor: "pointer", fontSize: isMobile ? "11px" : "13px" }}>👆</button>
            <button onClick={() => setMode("PAN")} style={{ background: mode === "PAN" ? "#007bff" : "#444", color: "#fff", border: "none", padding: "6px 10px", borderRadius: "4px", cursor: "pointer", fontSize: isMobile ? "11px" : "13px" }}>✋</button>
          </div>

          <div style={{ display: "flex", gap: "2px", background: "#333", padding: "2px", borderRadius: "4px" }}>
            <button onClick={() => { setMode("DRAW_LINE"); setLineMode("G01"); }} style={{ background: mode === "DRAW_LINE" && lineMode === "G01" ? "#28a745" : "#444", color: "#fff", border: "none", padding: "6px 10px", borderRadius: "4px", cursor: "pointer", fontSize: isMobile ? "11px" : "13px" }}>✏️ G01</button>
            <button onClick={() => { setMode("DRAW_LINE"); setLineMode("G00"); }} style={{ background: mode === "DRAW_LINE" && lineMode === "G00" ? "#dc3545" : "#444", color: "#fff", border: "none", padding: "6px 10px", borderRadius: "4px", cursor: "pointer", fontSize: isMobile ? "11px" : "13px" }}>🚀 G00</button>
          </div>

          <button onClick={() => { interactionRef.current.continuous = false; interactionRef.current.arcPts = []; setPaths((p) => [...p]); }} style={{ background: "#e83e8c", color: "#fff", border: "none", padding: "6px 10px", borderRadius: "4px", cursor: "pointer", fontWeight: "bold", fontSize: isMobile ? "11px" : "13px" }}>
            🏁 斷開
          </button>

          <div style={{ display: "flex", gap: "2px", background: "#333", padding: "2px", borderRadius: "4px" }}>
            <button onClick={() => { setMode("DRAW_ARC"); setArcSubMode("SCE"); interactionRef.current.arcPts = []; }} style={{ background: mode === "DRAW_ARC" && arcSubMode === "SCE" ? "#e83e8c" : "#444", color: "#fff", border: "none", padding: "6px", fontSize: "11px", cursor: "pointer" }}>弧:起中端</button>
            <button onClick={() => { setMode("DRAW_ARC"); setArcSubMode("SER"); interactionRef.current.arcPts = []; }} style={{ background: mode === "DRAW_ARC" && arcSubMode === "SER" ? "#e83e8c" : "#444", color: "#fff", border: "none", padding: "6px", fontSize: "11px", cursor: "pointer" }}>弧:起端半</button>
          </div>

          <div style={{ display: "flex", gap: "2px", background: "#333", padding: "2px", borderRadius: "4px" }}>
            <button onClick={() => { setMode("DRAW_CIRCLE"); setCircleSubMode("CEN"); interactionRef.current.circleStart = null; }} style={{ background: mode === "DRAW_CIRCLE" && circleSubMode === "CEN" ? "#e83e8c" : "#444", color: "#fff", border: "none", padding: "6px", fontSize: "11px", cursor: "pointer" }}>🔴圓</button>
          </div>

          {/* 🔥 組合修剪與橡皮擦 */}
          <div style={{ display: "flex", gap: "2px", background: "#333", padding: "2px", borderRadius: "4px" }}>
            <button onClick={() => setMode("TRIM")} style={{ background: mode === "TRIM" ? "#ff4444" : "#444", color: "#fff", border: "none", padding: "6px 10px", borderRadius: "4px", cursor: "pointer", fontSize: isMobile ? "11px" : "13px" }}>✂️ 修剪</button>
            <button onClick={() => setMode("ERASE")} style={{ background: mode === "ERASE" ? "#ff4444" : "#444", color: "#fff", border: "none", padding: "6px 10px", borderRadius: "4px", cursor: "pointer", fontSize: isMobile ? "11px" : "13px", fontWeight: "bold" }}>🧽 橡皮擦</button>
          </div>

          <div style={{ display: "flex", gap: "2px", background: "#333", padding: "2px", borderRadius: "4px" }}>
            <button onClick={() => setMode("CHAMFER")} style={{ background: mode === "CHAMFER" ? "#ffeb3b" : "#444", color: mode === "CHAMFER" ? "#000" : "#fff", border: "none", padding: "6px 10px", borderRadius: "4px", cursor: "pointer", fontWeight: "bold", fontSize: isMobile ? "11px" : "13px" }}>🔨 倒角</button>
            {mode === "CHAMFER" && (
              <div style={{ display: "flex", alignItems: "center", gap: "2px" }}>
                <select value={chamferType} onChange={(e) => setChamferType(e.target.value)} style={{ background: "#111", color: "#fff", border: "none", padding: "4px", fontSize: "11px" }}>
                  <option value="c">C</option>
                  <option value="r">R</option>
                </select>
                <input type="number" step="0.1" value={chamferVal} onChange={(e) => setChamferVal(Number(e.target.value))} style={{ width: "35px", background: "#111", color: "#fff", border: "none", padding: "4px", fontSize: "11px" }} />
              </div>
            )}
          </div>
          
          <div style={{ display: "flex", gap: "2px" }}>
             <button onClick={handleZoomToFit} style={{ background: "#17a2b8", color: "#fff", border: "none", padding: "6px 10px", borderRadius: "4px", cursor: "pointer", fontWeight: "bold", fontSize: isMobile ? "11px" : "13px" }}>🔍 全圖</button>
          </div>

          <button onClick={() => { saveState(); setPaths([]); setSelectedPathId(null); setSelRange({ pathId: null, p1: null, p2: null }); }} style={{ background: "#dc3545", color: "#fff", border: "none", padding: "6px 10px", borderRadius: "4px", cursor: "pointer", fontSize: isMobile ? "11px" : "13px" }}>✖ 清除</button>

          <label style={{ display: "flex", alignItems: "center", fontSize: "12px", cursor: "pointer", paddingLeft: "5px" }}>
            <input type="checkbox" checked={isOrtho} onChange={(e) => setIsOrtho(e.target.checked)} /> 📐 正交
          </label>
        </div>

        <div
          style={{
            position: "absolute",
            bottom: 10,
            left: 10,
            background: "rgba(0,0,0,0.6)",
            padding: "8px",
            borderRadius: "4px",
            color: "#00ff00",
            fontFamily: "monospace",
            fontSize: "13px",
            pointerEvents: "none" 
          }}
        >
          Z: <span id="coordZ">0.000</span> / X: <span id="coordX">0.000</span>
        </div>
      </div>

      <div
        style={{
          display: isFullscreen ? "none" : "block",
          width: isMobile ? "100%" : "400px", 
          minHeight: isMobile ? "45vh" : "100vh", 
          background: "#252526",
          padding: isMobile ? "15px" : "20px",
          borderLeft: isMobile ? "none" : "1px solid #444",
          borderTop: isMobile ? "1px solid #444" : "none", 
          overflowY: "auto",
        }}
      >
        <h3 style={{ color: "#00FFFF", marginTop: 0, fontSize: isMobile ? "16px" : "18px" }}>📦 參數與安全距離</h3>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: isMobile ? "1fr 1fr" : "1fr 1fr 1fr", 
            gap: "8px",
            marginBottom: "15px",
          }}
        >
          <div><label style={{ fontSize: "11px", color: "#ccc" }}>外徑 OD</label><input type="number" value={stock.od} onChange={(e) => setStock({ ...stock, od: Number(e.target.value) || 0 })} style={{ width: "100%", background: "#111", color: "#fff", border: "none", padding: "5px" }} /></div>
          <div><label style={{ fontSize: "11px", color: "#ccc" }}>內徑 ID</label><input type="number" value={stock.id} onChange={(e) => setStock({ ...stock, id: Number(e.target.value) || 0 })} style={{ width: "100%", background: "#111", color: "#fff", border: "none", padding: "5px" }} /></div>
          <div><label style={{ fontSize: "11px", color: "#ccc" }}>長度 L</label><input type="number" value={stock.length} onChange={(e) => setStock({ ...stock, length: Number(e.target.value) || 0 })} style={{ width: "100%", background: "#111", color: "#fff", border: "none", padding: "5px" }} /></div>
          <div><label style={{ fontSize: "11px", color: "#ffeb3b" }}>端面預留 Z</label><input type="number" step="0.1" value={stock.face} onChange={(e) => setStock({ ...stock, face: parseFloat(e.target.value) || 0 })} style={{ width: "100%", background: "#111", color: "#fff", border: "1px solid #ffeb3b", padding: "4px" }} /></div>
          <div><label style={{ fontSize: "11px", color: "#ccc" }}>粗車深 DOC</label><input type="number" step="0.1" value={cam.doc} onChange={(e) => setCam({ ...cam, doc: parseFloat(e.target.value) || 0 })} style={{ width: "100%", background: "#111", color: "#fff", border: "none", padding: "5px" }} /></div>
          <div><label style={{ fontSize: "11px", color: "#ccc" }}>進給 F</label><input type="number" step="0.05" value={cam.feed} onChange={(e) => setCam({ ...cam, feed: parseFloat(e.target.value) || 0 })} style={{ width: "100%", background: "#111", color: "#fff", border: "none", padding: "5px" }} /></div>
          <div><label style={{ fontSize: "11px", color: "#ccc" }}>轉速 G50</label><input type="number" value={cam.g50} onChange={(e) => setCam({ ...cam, g50: Number(e.target.value) || 0 })} style={{ width: "100%", background: "#111", color: "#fff", border: "none", padding: "5px" }} /></div>
          <div><label style={{ fontSize: "11px", color: "#0dcaf0" }}>X預留(U)</label><input type="number" step="0.1" value={cam.allowX} onChange={(e) => setCam({ ...cam, allowX: parseFloat(e.target.value) || 0 })} style={{ width: "100%", background: "#111", color: "#fff", border: "1px solid #0dcaf0", padding: "4px" }} /></div>
          <div><label style={{ fontSize: "11px", color: "#0dcaf0" }}>Z預留(W)</label><input type="number" step="0.1" value={cam.allowZ} onChange={(e) => setCam({ ...cam, allowZ: parseFloat(e.target.value) || 0 })} style={{ width: "100%", background: "#111", color: "#fff", border: "1px solid #0dcaf0", padding: "4px" }} /></div>
        </div>

        <button
          onClick={() => setIsInner(!isInner)}
          style={{ width: "100%", padding: "10px", background: isInner ? "#e83e8c" : "#007bff", color: "#fff", border: "none", borderRadius: "4px", marginBottom: "15px", fontWeight: "bold", cursor: "pointer" }}
        >
          加工方位：{isInner ? "內徑模式 (ID)" : "外徑模式 (OD)"}
        </button>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "5px", marginBottom: "15px", background: "#111", padding: "10px", borderRadius: "4px", border: "1px solid #333" }}>
          <div><label style={{ fontSize: "11px", color: "#aaa" }}>刀號</label><input type="text" value={toolConfig.code} onChange={(e) => setToolConfig({ ...toolConfig, code: e.target.value })} style={{ width: "100%", background: "#222", color: "#fff", border: "none", padding: "5px" }} /></div>
          <div><label style={{ fontSize: "11px", color: "#aaa" }}>R角</label><input type="number" step="0.1" value={toolConfig.r} onChange={(e) => setToolConfig({ ...toolConfig, r: parseFloat(e.target.value) || 0 })} style={{ width: "100%", background: "#222", color: "#fff", border: "none", padding: "5px" }} /></div>
          <div><label style={{ fontSize: "11px", color: "#aaa" }}>角度(°)</label><select value={toolConfig.angle} onChange={(e) => setToolConfig({ ...toolConfig, angle: parseInt(e.target.value) })} style={{ width: "100%", background: "#222", color: "#fff", border: "none", padding: "5px" }}><option value="35">VNMG(35)</option><option value="55">DNMG(55)</option><option value="80">CNMG(80)</option></select></div>
        </div>

        {activePath && (
          <div style={{ marginBottom: "15px", background: "#111", padding: "10px", borderRadius: "4px", border: "1px solid #333" }}>
            <h4 style={{ color: "#0dcaf0", fontSize: "13px", margin: "0 0 10px 0" }}>📏 尺寸與座標編輯</h4>
            
            {/* 🔥 新增：刪除整條選取路徑的按鈕 */}
            <button 
              onClick={() => {
                saveState();
                setPaths(prev => prev.filter(p => p.id !== activePath.id));
                setSelectedPathId(null);
                setSelRange({ pathId: null, p1: null, p2: null });
              }} 
              style={{ width: "100%", background: "#dc3545", color: "#fff", border: "none", padding: "6px", borderRadius: "4px", marginBottom: "10px", fontWeight: "bold", cursor: "pointer", fontSize: "12px" }}
            >
              🗑️ 刪除整條路徑
            </button>

            <div style={{ display: "flex", gap: "5px", marginBottom: "10px" }}>
              <input type="number" placeholder="Z偏移" value={transform.dz} onChange={e => setTransform({...transform, dz: e.target.value})} style={{ width: "33%", background: "#222", color: "#fff", border: "none", padding: "5px", fontSize: "11px" }} />
              <input type="number" placeholder="X偏移" value={transform.dx} onChange={e => setTransform({...transform, dx: e.target.value})} style={{ width: "33%", background: "#222", color: "#fff", border: "none", padding: "5px", fontSize: "11px" }} />
              <input type="number" placeholder="比例縮放" value={transform.scale} onChange={e => setTransform({...transform, scale: e.target.value})} style={{ width: "33%", background: "#222", color: "#fff", border: "none", padding: "5px", fontSize: "11px" }} />
            </div>
            <button onClick={applyTransform} style={{ width: "100%", background: "#0dcaf0", color: "#000", border: "none", padding: "5px", borderRadius: "4px", marginBottom: "10px", fontWeight: "bold", cursor: "pointer" }}>套用整段變換</button>
            <div style={{ maxHeight: "150px", overflowY: "auto", paddingRight: "5px" }}>
              {activePath.points.map((pt, idx) => (
                <div key={idx} style={{ display: "flex", gap: "5px", marginBottom: "5px", alignItems: "center" }}>
                  <span style={{ color: "#888", fontSize: "11px", width: "25px" }}>P{idx}</span>
                  <div style={{ display: "flex", flex: 1, alignItems: "center", gap: "2px" }}><span style={{ color: "#ccc", fontSize: "10px" }}>Z</span><input type="number" step="any" value={pt.x !== undefined ? Number(pt.x).toString() : ""} onFocus={saveState} onChange={(e) => handlePointChange(activePath.id, idx, 'Z', e.target.value)} style={{ width: "100%", background: "#222", color: "#fff", border: "1px solid #444", padding: "2px 4px", fontSize: "11px" }} /></div>
                  <div style={{ display: "flex", flex: 1, alignItems: "center", gap: "2px" }}><span style={{ color: "#ccc", fontSize: "10px" }}>X</span><input type="number" step="any" value={pt.y !== undefined ? Number(-pt.y * 2).toString() : ""} onFocus={saveState} onChange={(e) => handlePointChange(activePath.id, idx, 'X', e.target.value)} style={{ width: "100%", background: "#222", color: "#fff", border: "1px solid #444", padding: "2px 4px", fontSize: "11px" }} /></div>
                </div>
              ))}
            </div>
          </div>
        )}

        <button onClick={solidifyFeatures} style={{ width: "100%", padding: "10px", background: "#17a2b8", color: "white", border: "none", borderRadius: "4px", marginBottom: "10px", fontWeight: "bold", cursor: "pointer" }}>🔨 實體化所有倒角</button>
        <button onClick={startSimulation} style={{ width: "100%", padding: "15px", background: "#fd7e14", color: "white", border: "none", borderRadius: "4px", marginBottom: "10px", fontWeight: "bold", fontSize: "16px", cursor: "pointer" }}>▶️ 刀具路徑模擬</button>
        <button onClick={genGCode} style={{ width: "100%", padding: "15px", background: "#28a745", color: "white", border: "none", borderRadius: "4px", fontWeight: "bold", fontSize: "16px", cursor: "pointer" }}>🚀 產生 G-Code</button>
        
        <textarea value={gcode} readOnly style={{ width: "100%", height: isMobile ? "200px" : "300px", marginTop: "15px", background: "#000", color: "#00ff00", fontFamily: "monospace", fontSize: "11px", border: "1px solid #444" }} />
      </div>
    </div>
  );
};

export default function App() {
  return <CncWorkspace />;
}
