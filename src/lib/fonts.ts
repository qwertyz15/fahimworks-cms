import { Barlow_Condensed, Caveat, EB_Garamond, Nunito, Playfair_Display, Source_Serif_4 } from "next/font/google";

/*
 * Extra fonts for the Notebook font picker. next/font downloads them at build
 * time and serves them from this site (CSP font-src 'self'). preload: false —
 * a browser only fetches a font when some text on the page uses it.
 * (next/font needs literal options here — no shared object / spread.)
 */
export const serif = Source_Serif_4({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-serif-src" });
export const handwriting = Caveat({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-hand-src" });
export const rounded = Nunito({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-rounded-src" });
export const condensed = Barlow_Condensed({ subsets: ["latin"], display: "swap", preload: false, weight: ["400", "500", "600", "700"], variable: "--font-condensed-src" });
export const book = EB_Garamond({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-book-src" });
export const display = Playfair_Display({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-display-src" });

export const editorFontVariables = [serif, handwriting, rounded, condensed, book, display].map((f) => f.variable).join(" ");
