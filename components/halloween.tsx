import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * Las piezas del tema de Halloween (ver `lib/tema.ts`).
 *
 * Todas son decorativas: `aria-hidden` y sin eventos. Son SVG en línea y no
 * imágenes para que funcionen sin cobertura sin cachear nada más y tomen los
 * colores del tema (`--sang`, `--lluna`). Quien las pone les añade
 * `nomes-halloween`, y con el tema de siempre ni se pintan.
 *
 * Los trazados largos —gotas, tejados, estrellas, telaraña— se generaron una
 * sola vez con una semilla fija y están escritos aquí tal cual: el servidor y
 * el navegador pintan exactamente lo mismo.
 */

/** El negro de las siluetas: más hondo que el del texto, para que se recorten contra la luna. */
const SILUETA = "#0b090f";

const GOTES_D = "M9.4 5Q20.1 9.8 30.9 5ZM36.3 5Q50.8 13.0 65.2 5ZM92.9 5Q104.6 10.4 116.4 5ZM129.7 5Q139.2 13.6 148.7 5ZM183.4 5Q187.5 5 187.5 9.1L187.5 12.6C187.5 14.7 186.4 15.0 186.4 16.1A3.5 3.5 0 0 0 193.5 16.1C193.5 15.0 192.3 14.7 192.3 12.6L192.3 9.1Q192.3 5 196.4 5ZM247.4 5Q252.2 5 252.2 9.7L252.2 13.0C252.2 15.1 251.1 15.4 251.1 16.5A3.5 3.5 0 0 0 258.2 16.5C258.2 15.4 257.1 15.1 257.1 13.0L257.1 9.7Q257.1 5 261.8 5ZM298.8 5Q310.1 9.4 321.4 5ZM358.1 5Q363.5 5 363.5 10.3L363.5 13.3C363.5 15.3 362.2 15.7 362.2 16.7A3.3 3.3 0 0 0 368.9 16.7C368.9 15.7 367.7 15.3 367.7 13.3L367.7 10.3Q367.7 5 373.0 5ZM431.0 5Q435.7 5 435.7 9.7L435.7 12.7C435.7 14.7 434.4 15.1 434.4 16.1A3.4 3.4 0 0 0 441.2 16.1C441.2 15.1 439.9 14.7 439.9 12.7L439.9 9.7Q439.9 5 444.6 5ZM464.0 5Q477.7 9.2 491.3 5ZM504.4 5Q508.8 5 508.8 9.4L508.8 12.4C508.8 14.4 507.4 14.7 507.4 15.7A3.2 3.2 0 0 0 513.9 15.7C513.9 14.7 512.4 14.4 512.4 12.4L512.4 9.4Q512.4 5 516.9 5ZM575.9 5Q586.8 10.0 597.7 5ZM622.9 5Q633.4 12.7 643.9 5ZM664.7 5Q668.3 5 668.3 8.6L668.3 11.6C668.3 13.8 667.3 14.1 667.3 15.2A3.6 3.6 0 0 0 674.4 15.2C674.4 14.1 673.3 13.8 673.3 11.6L673.3 8.6Q673.3 5 677.0 5ZM731.0 5Q734.9 5 734.9 8.9L734.9 12.1C734.9 13.9 733.6 14.2 733.6 15.1A3.0 3.0 0 0 0 739.7 15.1C739.7 14.2 738.4 13.9 738.4 12.1L738.4 8.9Q738.4 5 742.2 5ZM762.7 5Q767.6 5 767.6 10.0L767.6 14.1C767.6 16.7 765.9 17.1 765.9 18.4A4.2 4.2 0 0 0 774.4 18.4C774.4 17.1 772.6 16.7 772.6 14.1L772.6 10.0Q772.6 5 777.6 5ZM789.6 5Q804.4 12.9 819.1 5ZM842.4 5Q846.5 5 846.5 9.1L846.5 12.1C846.5 14.4 844.8 14.8 844.8 15.9A3.8 3.8 0 0 0 852.5 15.9C852.5 14.8 850.8 14.4 850.8 12.1L850.8 9.1Q850.8 5 854.9 5ZM889.8 5Q900.4 13.8 911.1 5ZM930.1 5Q938.4 9.8 946.7 5ZM976.6 5Q986.7 9.5 996.7 5ZM1032.7 5Q1042.2 9.3 1051.6 5ZM1058.4 5Q1071.2 9.7 1083.9 5ZM1093.3 5Q1103.1 14.0 1112.8 5ZM1120.8 5Q1134.2 11.0 1147.6 5ZM1183.6 5Q1193.3 11.1 1203.0 5ZM1212.3 5Q1222.0 13.4 1231.8 5ZM1264.8 5Q1273.0 10.3 1281.3 5ZM1296.4 5Q1306.0 13.3 1315.7 5ZM1323.1 5Q1337.6 11.8 1352.1 5ZM1383.6 5Q1397.9 12.3 1412.2 5ZM1446.3 5Q1450.3 5 1450.3 8.9L1450.3 15.6C1450.3 17.5 1449.2 17.8 1449.2 18.7A3.1 3.1 0 0 0 1455.4 18.7C1455.4 17.8 1454.4 17.5 1454.4 15.6L1454.4 8.9Q1454.4 5 1458.3 5ZM1516.9 5Q1522.0 5 1522.0 10.1L1522.0 13.1C1522.0 15.1 1520.5 15.5 1520.5 16.5A3.4 3.4 0 0 0 1527.3 16.5C1527.3 15.5 1525.7 15.1 1525.7 13.1L1525.7 10.1Q1525.7 5 1530.8 5Z";
/** Un brillo en cada gota larga: x, y, radio x, radio y. */
const GOTES_BRILL = "188.6,15.9,1.0,1.8 253.3,16.3,1.0,1.8 364.3,16.5,0.9,1.7 436.5,15.9,0.9,1.7 509.4,15.5,0.9,1.6 669.5,15.0,1.0,1.8 735.5,15.0,0.8,1.5 768.5,18.2,1.2,2.1 847.2,15.7,1.1,1.9 1451.1,18.6,0.9,1.6 1522.6,16.3,1.0,1.7";
const TEULADES_D = "M0 64L0 28L37 28L37 20L43 20L43 28L63 28L63 37L93 27L123 37L123 38L154 38L154 30L160 30L160 38L176 38L176 51L208 51L208 28L222.5 18L237 28L237 52L272 52L272 44L278 44L278 52L296 52L296 30L315 30L315 22L321 22L321 30L329 30L329 22L338 10L347 22L347 18L355 6L363 18L363 28L371.5 16L380 28L380 39L411 39L411 31L417 31L417 39L433 39L433 42L455.5 32L478 42L478 48L513 48L513 21L522.5 9L532 21L532 46L563.5 36L595 46L595 32L649 32L649 46L678 46L678 34L747 34L747 28L763 28L763 20L769 20L769 28L775 28L775 41L808 31L841 41L841 40L877 40L877 33L898 23L919 33L919 35L953 25L987 35L987 33L1016 23L1045 33L1045 64Z";
/** Ventanas encendidas: x, y. */
const FINESTRES = "97,47 103,43 223,40 309,45 305,48 439,51 627,41 638,42 693,43 757,46 754,40 818,50";
const TERANYINA_D = "M140 0L-60.0 0.0M140 0L-51.3 58.5M140 0L-21.8 117.6M140 0L25.3 163.8M140 0L81.5 191.3M140 0L140.0 200.0M120.0 0.0Q123.6 2.5 120.9 5.8Q125.1 7.4 123.8 11.8Q128.4 11.8 128.5 16.4Q132.7 14.9 134.2 19.1Q137.5 16.4 140.0 20.0M99.0 0.0Q106.3 5.0 100.8 12.0Q109.5 15.2 106.8 24.1Q116.1 24.3 116.5 33.6Q125.1 30.6 128.0 39.2Q135.0 33.7 140.0 41.0M76.0 0.0Q87.5 7.9 78.8 18.7Q92.5 23.7 88.2 37.6Q102.8 37.9 103.3 52.4Q116.7 47.7 121.3 61.2Q132.1 52.5 140.0 64.0M50.0 0.0Q66.1 11.0 53.9 26.3Q73.1 33.3 67.2 52.9Q87.6 53.3 88.4 73.7Q107.3 67.1 113.7 86.1Q129.0 73.9 140.0 90.0M20.0 0.0Q41.5 14.7 25.2 35.1Q50.9 44.4 42.9 70.5Q70.2 71.0 71.2 98.3Q96.3 89.5 104.9 114.8Q125.3 98.5 140.0 120.0";
/** x, y, radio, opacidad. */
const ESTRELLES = "95,98,0.8,0.58 250,12,0.5,0.71 104,42,1.3,0.51 335,86,1.0,0.33 254,156,0.9,0.66 269,12,1.1,0.58 121,6,1.2,0.51 288,158,1.1,0.76 158,144,0.9,0.76 352,18,0.6,0.37 386,79,1.0,0.42 203,69,0.8,0.57 234,163,1.0,0.76 343,178,1.0,0.34 344,174,1.2,0.56 286,38,1.2,0.57 114,11,1.2,0.79 35,144,0.8,0.33 118,138,1.2,0.27 246,8,1.1,0.43 352,177,0.9,0.80 124,14,1.0,0.27 79,73,1.0,0.34 17,156,0.8,0.78 359,68,0.9,0.54 258,107,0.9,0.59 376,91,0.8,0.65 95,54,1.3,0.54";
const RATPENAT_D =
  "M32 6L34 3L35 8Q46 1 62 5Q56 8 55 14Q51 10 47 12Q44 14 42 19Q38 14 35 15Q33 20 32 21Q31 20 29 15Q26 14 22 19Q20 14 17 12Q13 10 9 14Q8 8 2 5Q18 1 29 8L30 3Z";

const llista = (s: string) => s.split(" ").map((t) => t.split(",").map(Number));

/**
 * Sangre que gotea del borde de arriba de la pantalla.
 *
 * Fija y por encima de la cabecera, pero por debajo de las pantallas que se
 * abren encima (z-50), que ya traen su propia cabecera.
 */
export function GotesSang() {
  return (
    <div
      className="nomes-halloween pointer-events-none fixed inset-x-0 top-0 z-40 h-6 print:hidden"
      aria-hidden
    >
      {/* `slice`: a cualquier ancho se ve un trozo, nunca unas gotas estiradas. */}
      <svg viewBox="0 0 1600 24" preserveAspectRatio="xMinYMin slice" className="block size-full">
        <defs>
          <linearGradient id="gotes-sang" x1="0" y1="0" x2="0" y2="24" gradientUnits="userSpaceOnUse">
            <stop offset="0" style={{ stopColor: "var(--sang-fosc)" }} />
            <stop offset="0.4" style={{ stopColor: "var(--sang)" }} />
          </linearGradient>
        </defs>
        {/* La franja va aparte y montada medio píxel sobre las gotas: en el
            mismo trazado, el solape se restaría y quedaría una raya. */}
        <rect width="1600" height="5.5" fill="url(#gotes-sang)" />
        <path d={GOTES_D} fill="url(#gotes-sang)" />
        {llista(GOTES_BRILL).map(([cx, cy, rx, ry]) => (
          <ellipse key={`${cx}-${cy}`} cx={cx} cy={cy} rx={rx} ry={ry} fill="#fff" opacity={0.3} />
        ))}
      </svg>
    </div>
  );
}

/** La calabaza de la marca. */
export function Carbassa({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("shrink-0", className)} aria-hidden>
      <path d="M16.2 8.5C16.4 6 17.6 4.2 20 3.4" fill="none" stroke="#4a5a2a" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M19.5 5.2c2.2-.9 4.4-.3 5.3 1.4-2.1.9-4.2.6-5.3-1.4z" fill="#6b7f3a" />
      <ellipse cx="10.6" cy="18.6" rx="7.6" ry="9.6" fill="#c25e1e" />
      <ellipse cx="21.4" cy="18.6" rx="7.6" ry="9.6" fill="#c25e1e" />
      <ellipse cx="16" cy="18.6" rx="6.6" ry="10.2" fill="#e07a2c" />
      <path d="M13.2 11.5c-1 2.2-1.3 5.4-.6 8.5" fill="none" stroke="#f4a261" strokeWidth="1.2" strokeLinecap="round" opacity="0.7" />
    </svg>
  );
}

/** Murciélago. Toma el color del texto: `text-…` para cambiarlo. */
export function Ratpenat({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 24" className={cn("h-auto", className)} aria-hidden>
      <path d={RATPENAT_D} fill="currentColor" />
    </svg>
  );
}

/** Gota de sangre suelta: marca la sección activa. */
export function Gota({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 12 16" className={className} aria-hidden>
      <path d="M6 1C6 1 1.5 7 1.5 10.2a4.5 4.5 0 0 0 9 0C10.5 7 6 1 6 1Z" style={{ fill: "var(--sang-clar)" }} />
    </svg>
  );
}

/**
 * Viuda negra colgando de su hilo. El hilo estira con el alto que le dé
 * `className`; la araña queda siempre abajo.
 */
export function Aranya({ className, fil = "bg-current/40" }: { className?: string; fil?: string }) {
  return (
    <div className={cn("flex flex-col items-center", className)} aria-hidden>
      <span className={cn("w-px flex-1", fil)} />
      <svg viewBox="0 5 28 19" className="w-full shrink-0">
        <g fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M11 10L6.5 6L3.5 9.5M10.6 12L5 11L2 14.5M10.6 13.6L6 16.5L4.2 20.5M11.2 15.2L8.5 19.5L7.6 23" />
          <path d="M17 10L21.5 6L24.5 9.5M17.4 12L23 11L26 14.5M17.4 13.6L22 16.5L23.8 20.5M16.8 15.2L19.5 19.5L20.4 23" />
        </g>
        <circle cx="14" cy="8.6" r="2.7" fill="currentColor" />
        <ellipse cx="14" cy="14.4" rx="4.2" ry="5" fill="currentColor" />
        <path d="M12.7 12.6H15.3L14 14.3ZM12.7 16.3H15.3L14 14.6Z" style={{ fill: "var(--sang-clar)" }} />
      </svg>
    </div>
  );
}

function Lluna({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 80 80" className={className}>
      <circle cx="40" cy="40" r="36" fill="#f1e8d4" />
      <circle cx="28" cy="31" r="7" fill="#e3d7be" />
      <circle cx="50" cy="51" r="9" fill="#e3d7be" />
      <circle cx="54" cy="25" r="4" fill="#e3d7be" />
      <circle cx="29" cy="56" r="3" fill="#e3d7be" />
    </svg>
  );
}

/** Telaraña de rincón, anclada arriba a la derecha. */
function Teranyina({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 140 140" className={cn("text-[var(--lluna)]", className)}>
      <path d={TERANYINA_D} fill="none" stroke="currentColor" strokeOpacity="0.3" strokeLinecap="round" />
    </svg>
  );
}

function Estrelles({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 400 180" preserveAspectRatio="xMidYMin slice" className={className}>
      {llista(ESTRELLES).map(([cx, cy, r, o]) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} opacity={o} style={{ fill: "var(--lluna)" }} />
      ))}
    </svg>
  );
}

/** Tejados con alguna ventana encendida. Se alinea abajo a la derecha. */
function Teulades({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 1000 64" preserveAspectRatio="xMaxYMax slice" className={className}>
      <path d={TEULADES_D} fill={SILUETA} />
      {llista(FINESTRES).map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width="4" height="6" rx="1" fill="#e9b44c" opacity="0.85" />
      ))}
    </svg>
  );
}

/*
 * Las escenas de noche. Van dentro de una tarjeta con `tema-nit`, que les
 * da el cielo; aquí solo se colocan las piezas, contando desde la esquina
 * de arriba a la derecha, que es donde la tarjeta no lleva texto.
 */

/** "Ruta d'avui": la luna a la izquierda de la furgoneta, que va abajo a la derecha. */
export function EscenaRuta() {
  return (
    <div className="escena-nit nomes-halloween" aria-hidden>
      <Estrelles className="estrelles-dreta absolute inset-x-0 top-0 h-40 w-full" />
      <div className="lluna-halo right-[108px] top-[-52px] size-[200px]" />
      <Lluna className="absolute right-[128px] top-2.5 size-11" />
      <Teranyina className="absolute right-0 top-0 size-24" />
      <Ratpenat className="absolute right-[134px] top-[26px] w-8 -rotate-6 text-[#0b090f]" />
      <Ratpenat className="absolute right-[92px] top-3.5 w-4 rotate-12 text-[#0b090f]" />
      <Teulades className="absolute bottom-0 left-[45%] right-0 h-12" />
    </div>
  );
}

/** "Per facturar": sin tejados, que abajo va el botón a todo lo ancho. */
export function EscenaFactura() {
  return (
    <div className="escena-nit nomes-halloween" aria-hidden>
      {/* Solo arriba: el botón apagado es translúcido y se verían a través. */}
      <Estrelles className="estrelles-dreta absolute inset-x-0 top-0 h-24 w-full" />
      <div className="lluna-halo right-[-20px] top-[-68px] size-[180px]" />
      <Lluna className="absolute right-[50px] top-3 size-10" />
      <Teranyina className="absolute right-0 top-0 size-20" />
      <Ratpenat className="absolute right-[54px] top-[24px] w-7 -rotate-6 text-[#0b090f]" />
      <Ratpenat className="absolute right-[104px] top-[18px] w-4 rotate-12 text-[#0b090f]" />
    </div>
  );
}

/**
 * La mitad de arriba del login: luna grande con la viuda negra delante,
 * tejados y la furgoneta. Abajo la tapa la hoja blanca (-mt-8), así que los
 * tejados bajan hasta el borde y parece que la ciudad sigue por detrás.
 */
export function EscenaAcces() {
  return (
    <div className="escena-nit nomes-halloween" aria-hidden>
      <Estrelles className="absolute inset-x-0 top-0 h-2/3 w-full" />
      <div className="lluna-halo right-[-46px] top-[-40px] size-[240px] lg:right-[-24px] lg:top-[-4px] lg:size-[340px]" />
      <Lluna className="absolute right-[30px] top-[34px] size-[72px] lg:right-16 lg:top-24 lg:size-28" />
      <Aranya
        className="absolute right-[53px] top-0 h-[80px] w-[26px] text-[#0b090f] lg:right-[106px] lg:h-[150px] lg:w-[30px]"
        fil="bg-[var(--lluna)]/50"
      />
      <Ratpenat className="absolute right-[56px] top-[88px] w-8 -rotate-6 text-[#0b090f] lg:right-[112px] lg:top-[176px] lg:w-11" />
      <Ratpenat className="absolute right-[196px] top-[122px] w-5 rotate-6 text-[#0b090f] lg:right-[280px] lg:top-[150px] lg:w-6" />
      <Ratpenat className="absolute right-[150px] top-[40px] w-3.5 -rotate-12 text-[#0b090f] lg:right-[210px] lg:top-[92px] lg:w-4" />
      <Teulades className="absolute inset-x-0 bottom-0 h-24 lg:h-[88px]" />
      {/* Solo en el móvil: en pantalla grande abajo va el lema, y lo tapaba. */}
      <Image
        src="/furgoneta.webp"
        alt=""
        width={420}
        height={396}
        unoptimized
        className="absolute bottom-7 right-4 w-[150px] select-none lg:hidden"
      />
    </div>
  );
}
