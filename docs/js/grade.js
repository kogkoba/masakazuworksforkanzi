/**
 * ===============================
 * 採点ロジック (IoU: Intersection over Union)
 * ===============================
 * 使い方:
 *   const score = gradeIoU(drawCanvas, underCanvas);
 *   // scoreは 0〜1 の範囲（0.7なら70%）
 */

/**
 * メイン関数
 * @param {HTMLCanvasElement} drawCanvas - ユーザーの描いたキャンバス
 * @param {HTMLCanvasElement} underCanvas - 模範文字のキャンバス
 * @returns {number} IoU値 (0.0〜1.0)
 */
function gradeIoU(drawCanvas, underCanvas){
  const drawn = binarize(drawCanvas);
  const model = binarize(underCanvas);

  const A = extractAndNormalize(drawn);
  const B = extractAndNormalize(model);

  const N = 64; // 評価用の縮小サイズ
  const aMap = toBinaryMap(A, N);
  const bMap = toBinaryMap(B, N);

  let inter=0, union=0;
  for(let i=0;i<N*N;i++){
    const a=aMap[i], b=bMap[i];
    if(a || b) union++;
    if(a && b) inter++;
  }
  if(union===0) return 0;
  return inter/union;
}

/* ---------- 内部関数 ---------- */

/**
 * キャンバスを2値化して返す
 */
function binarize(canvas){
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext("2d");
  const img = ctx.getImageData(0,0,W,H);
  const data = img.data;
  const out = new Uint8ClampedArray(W*H);
  for(let i=0;i<data.length;i+=4){
    const r=data[i], g=data[i+1], b=data[i+2], a=data[i+3];
    const lum = (r+g+b)/3;
    out[i/4] = (a>10 && lum>20) ? 1 : 0;
  }
  return { W,H,map:out };
}

/**
 * バウンディングボックスを切り出して正規化
 */
function extractAndNormalize(bin){
  let minX=bin.W, minY=bin.H, maxX=0, maxY=0, any=false;
  for(let y=0;y<bin.H;y++){
    for(let x=0;x<bin.W;x++){
      const v = bin.map[y*bin.W+x];
      if(v){
        any=true;
        if(x<minX)minX=x;
        if(y<minY)minY=y;
        if(x>maxX)maxX=x;
        if(y>maxY)maxY=y;
      }
    }
  }
  if(!any){
    return {W:1,H:1,map:new Uint8ClampedArray([0])};
  }
  const w = (maxX-minX+1), h=(maxY-minY+1);
  const cut = new Uint8ClampedArray(w*h);
  for(let y=0;y<h;y++){
    for(let x=0;x<w;x++){
      cut[y*w+x] = bin.map[(minY+y)*bin.W + (minX+x)];
    }
  }
  return {W:w,H:h,map:cut};
}

/**
 * 指定サイズに縮小し、中央に配置
 */
function toBinaryMap(src, N){
  const out = new Uint8ClampedArray(N*N);
  const scale = Math.min(N/src.W, N/src.H);
  const w = Math.max(1, Math.floor(src.W*scale));
  const h = Math.max(1, Math.floor(src.H*scale));

  const tmp = new Uint8ClampedArray(w*h);
  for(let y=0;y<h;y++){
    const sy = Math.floor(y/scale);
    for(let x=0;x<w;x++){
      const sx = Math.floor(x/scale);
      tmp[y*w+x] = src.map[sy*src.W+sx];
    }
  }

  const offX = Math.floor((N-w)/2);
  const offY = Math.floor((N-h)/2);
  for(let y=0;y<h;y++){
    for(let x=0;x<w;x++){
      out[(offY+y)*N + (offX+x)] = tmp[y*w+x];
    }
  }
  return out;
}
