// Cache for loaded images
const imgCache = new Map<string, HTMLImageElement>();

function loadImg(url: string): Promise<HTMLImageElement> {
  if (imgCache.has(url)) return Promise.resolve(imgCache.get(url)!);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => { imgCache.set(url, img); resolve(img); };
    img.onerror = reject;
    img.src = url;
  });
}

function drawCircularImage(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  cx: number,
  cy: number,
  radius: number,
  borderWidth: number = 2,
  borderColor: string = '#ffffff',
) {
  // Border
  ctx.beginPath();
  ctx.arc(cx, cy, radius + borderWidth, 0, Math.PI * 2);
  ctx.fillStyle = borderColor;
  ctx.fill();

  // Clip and draw image
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.clip();

  const imgRatio = img.width / img.height;
  const size = radius * 2;
  let dw = size, dh = size, dx = cx - radius, dy = cy - radius;
  if (imgRatio > 1) {
    dw = size * imgRatio;
    dx = cx - dw / 2;
  } else {
    dh = size / imgRatio;
    dy = cy - dh / 2;
  }
  ctx.drawImage(img, dx, dy, dw, dh);
  ctx.restore();
}

function drawCountBadge(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  count: number,
) {
  const text = count > 99 ? '99+' : `+${count}`;
  const fontSize = 11;
  ctx.font = `700 ${fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
  const metrics = ctx.measureText(text);
  const badgeW = Math.max(metrics.width + 8, 22);
  const badgeH = 18;

  // Badge background
  ctx.beginPath();
  ctx.roundRect(x - badgeW / 2, y - badgeH / 2, badgeW, badgeH, badgeH / 2);
  ctx.fillStyle = '#d4a853';
  ctx.fill();

  // Badge text
  ctx.fillStyle = '#102a45';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
}

function drawFallbackCircle(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  count: number,
) {
  // Outer glow
  const gradient = ctx.createRadialGradient(cx, cy, radius * 0.6, cx, cy, radius + 6);
  gradient.addColorStop(0, 'rgba(212, 168, 83, 0.5)');
  gradient.addColorStop(1, 'rgba(212, 168, 83, 0)');
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 6, 0, Math.PI * 2);
  ctx.fillStyle = gradient;
  ctx.fill();

  // Main circle
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = '#1e3a5f';
  ctx.fill();

  // Border
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.strokeStyle = '#d4a853';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Count text
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 16px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${count}`, cx, cy);
}

export async function renderClusterCanvas(
  photoUrls: string[],
  totalCount: number,
  size: number = 80,
): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const cx = size / 2;
  const cy = size / 2;

  // Load available images
  const results = await Promise.allSettled(
    photoUrls.slice(0, 4).map((url) => loadImg(url))
  );
  const images = results
    .filter((r): r is PromiseFulfilledResult<HTMLImageElement> => r.status === 'fulfilled')
    .map((r) => r.value);

  if (images.length === 0) {
    drawFallbackCircle(ctx, cx, cy, size / 2 - 4, totalCount);
    return canvas;
  }

  const r = size * 0.32;

  if (images.length === 1) {
    ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
    ctx.shadowBlur = 6;
    drawCircularImage(ctx, images[0], cx, cy, r, 3);
    ctx.shadowBlur = 0;
  } else if (images.length === 2) {
    ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
    ctx.shadowBlur = 4;
    drawCircularImage(ctx, images[1], cx + r * 0.35, cy + r * 0.15, r * 0.85, 2);
    ctx.shadowBlur = 0;
    drawCircularImage(ctx, images[0], cx - r * 0.35, cy - r * 0.15, r * 0.85, 2);
  } else if (images.length === 3) {
    ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
    ctx.shadowBlur = 4;
    const smallR = r * 0.7;
    drawCircularImage(ctx, images[2], cx + smallR * 0.6, cy + smallR * 0.5, smallR, 2);
    drawCircularImage(ctx, images[1], cx - smallR * 0.6, cy + smallR * 0.5, smallR, 2);
    ctx.shadowBlur = 0;
    drawCircularImage(ctx, images[0], cx, cy - smallR * 0.5, smallR, 2);
  } else {
    const smallR = r * 0.58;
    const offset = smallR + 2;
    ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
    ctx.shadowBlur = 3;
    drawCircularImage(ctx, images[3], cx + offset * 0.5, cy + offset * 0.5, smallR, 1.5);
    drawCircularImage(ctx, images[2], cx - offset * 0.5, cy + offset * 0.5, smallR, 1.5);
    drawCircularImage(ctx, images[1], cx + offset * 0.5, cy - offset * 0.5, smallR, 1.5);
    ctx.shadowBlur = 0;
    drawCircularImage(ctx, images[0], cx - offset * 0.5, cy - offset * 0.5, smallR, 1.5);
  }

  // Count badge if more items than photos shown
  if (totalCount > images.length) {
    drawCountBadge(ctx, cx + size * 0.3, cy + size * 0.3, totalCount - images.length);
  }

  return canvas;
}
