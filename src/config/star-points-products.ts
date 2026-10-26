/**
 * Star Points Q3 FY 2026-27 – Table III "List of Products under each category".
 *
 * Source: circular ACME/SALES/Q3-FY27-SCHEME/1st Oct '26 (Star Points Q3 FY 2026-27), Table III, pages 3–8.
 * The PDF is outside the repository (see docs/scheme-rules-reference.md section 1). Transcribed row by row, in circular order.
 * One row per product code (the circular has no duplicate codes).
 *
 * productCode = 6-digit base product code (zsd_sales.product_code = test_product.baseproduct).
 * Only these products count for points ("Beyond these products, no other product will be considered").
 * Tools (Rollers, Sandpapers, Masking Tapes) are not in Table III. See SP_TOOLS_PRODUCT_CODES in schemes.ts.
 *
 * channel12Eligible: circular page 1 – "In Channel 12 billing (Institutional): Only Trade products of
 * Acme One Emulsions topcoats as mentioned in the product list will be included".
 * Rule used (ASSUMPTION, see docs/assumptions.md): brand "One" AND product category "Interior Emulsions" or
 * "Exterior Emulsions" AND not a putty or primer. This excludes 941006 Pro Smooth Putty.
 */
import type { StarCategory } from "@/engine/types";

export interface GtProduct {
  productCode: string;
  productName: string;
  productCategory: string;
  brand: string;
  starCategory: StarCategory;
  channel12Eligible: boolean;
}

type Row = [code: string, name: string, productCategory: string, brand: string];

const LUXURY: Row[] = [
  // page 3
  ["971003", "Crack Master Paste", "Water Proofing", "Drycoat"],
  ["936010", "Total Stop", "Water Proofing", "Drycoat"],
  ["950001", "Italian PU Sealer", "Wood finishes", "Woodcraft"],
  ["950002", "Italian PU Sealer Base", "Wood finishes", "Woodcraft"],
  ["950003", "Italian PU Sealer & Matte Hardener", "Wood finishes", "Woodcraft"],
  ["950004", "Italian PU Matte", "Wood finishes", "Woodcraft"],
  ["950005", "Italian PU Matte Base", "Wood finishes", "Woodcraft"],
  ["950006", "Italian PU Matte Hardener", "Wood finishes", "Woodcraft"],
  ["950007", "Italian PU Gloss", "Wood finishes", "Woodcraft"],
  ["950008", "Italian PU Gloss Base", "Wood finishes", "Woodcraft"],
  ["950009", "Italian PU Gloss Clear & Gloss White Hardener", "Wood finishes", "Woodcraft"],
  ["950010", "PU Interior Sealer", "Wood finishes", "Woodcraft"],
  ["950011", "PU Exterior Sealer", "Wood finishes", "Woodcraft"],
  ["950012", "PU Interior Matte", "Wood finishes", "Woodcraft"],
  ["950013", "PU Interior Gloss", "Wood finishes", "Woodcraft"],
  ["950014", "PU Exterior Matte", "Wood finishes", "Woodcraft"],
  ["950015", "PU Exterior Gloss", "Wood finishes", "Woodcraft"],
  ["950017", "PU Color Sealer", "Wood finishes", "Woodcraft"],
  ["950018", "PU Color Interior Satin", "Wood finishes", "Woodcraft"],
  ["950019", "PU Color Interior Gloss", "Wood finishes", "Woodcraft"],
  ["950020", "PU Color Exterior Gloss", "Wood finishes", "Woodcraft"],
  ["950021", "PU Color Interior Metalic", "Wood finishes", "Woodcraft"],
  ["953007", "Wood Stain Walnut", "Wood finishes", "Woodcraft"],
  ["953008", "Wood Stain Teak", "Wood finishes", "Woodcraft"],
  ["953009", "Wood Stain Wenge", "Wood finishes", "Woodcraft"],
  ["953010", "Wood Stain OakYellow", "Wood finishes", "Woodcraft"],
  ["953011", "Wood Stain RedBrown", "Wood finishes", "Woodcraft"],
  ["953012", "Wood Stain Rosewood", "Wood finishes", "Woodcraft"],
  ["953013", "Wood Stain Charcoal", "Wood finishes", "Woodcraft"],
  ["517049", "Italian Pu White Sealer Base", "Wood finishes", "Woodcraft"],
  ["517059", "Italian Pu White Matt Base", "Wood finishes", "Woodcraft"],
  ["517069", "Italian Pu White Gloss Base", "Wood finishes", "Woodcraft"],
  ["517089", "Italian Pu Clear & White Glossy Hardner", "Wood finishes", "Woodcraft"],
  ["517099", "Italian Pu White Sealer Hardener", "Wood finishes", "Woodcraft"],
  ["517109", "Italian Pu White Matt Hardener", "Wood finishes", "Woodcraft"],
  ["517149", "Italian Pu White Sealer Kit", "Wood finishes", "Woodcraft"],
  ["517169", "Italian Pu White Gloss Kit", "Wood finishes", "Woodcraft"],
  ["517209", "Epoxy Isolant", "Wood finishes", "Woodcraft"],
  // page 4
  ["517019", "Italian Pu Clear Sealer Base", "Wood finishes", "Woodcraft"],
  ["517029", "Italian Pu Clear Matt Base", "Wood finishes", "Woodcraft"],
  ["517079", "Italian Pu Clear Sealer & Matt Hardner", "Wood finishes", "Woodcraft"],
  ["517119", "Italian Pu", "Wood finishes", "Woodcraft"],
  ["517129", "Italian Pu Clear Matt Kit", "Wood finishes", "Woodcraft"],
  ["517139", "Italian Pu Clear Gloss Kit", "Wood finishes", "Woodcraft"],
  ["517159", "Italian Pu White Matt Kit", "Wood finishes", "Woodcraft"],
  ["517039", "Italian Pu Clear Gloss Base", "Wood finishes", "Woodcraft"],
  ["950024", "PEI 99 Woodcraft Epoxy Isolant Kit-4L", "Wood finishes", "Woodcraft"],
  ["950025", "EPOXY ISOLANT BASE", "Wood finishes", "Woodcraft"],
  ["950026", "EPOXY ISOLANT HARDENER", "Wood finishes", "Woodcraft"],
  ["517189", "Woodcraft IT PU", "Wood finishes", "Woodcraft"],
  ["517199", "Woodcraft Epoxy Isolant", "Wood finishes", "Woodcraft"],
  ["953907", "Wood stain", "Wood finishes", "Woodcraft"],
  ["953908", "Wood stain", "Wood finishes", "Woodcraft"],
  ["953910", "Wood stain", "Wood finishes", "Woodcraft"],
  ["953911", "Wood stain", "Wood finishes", "Woodcraft"],
  ["953912", "Wood stain", "Wood finishes", "Woodcraft"],
  ["953913", "Wood stain", "Wood finishes", "Woodcraft"],
  ["953022", "Woodcraft Wood Stain Walnut", "Wood finishes", "Woodcraft"],
  ["950023", "ITALIAN PU SEALER HARDENER", "Wood finishes", "Woodcraft"],
  ["950016", "ITALIAN PU SEALER HARDENER", "Wood finishes", "Woodcraft"],
  ["950029", "Italian Pu Clear Sealer Kit", "Wood finishes", "Woodcraft"],
  ["950028", "Italian Pu Sealer", "Wood finishes", "Woodcraft"],
  ["950030", "Italian Pu Sealer Hardener", "Wood finishes", "Woodcraft"],
  ["950050", "Woodcraft SFX", "Wood finishes", "Woodcraft"],
  ["950037", "Italian Pu Semi Matt", "Wood finishes", "Woodcraft"],
  ["950038", "It Pu Matt Semi Base", "Wood finishes", "Woodcraft"],
  ["950039", "It Pu Semi Matt Hardener", "Wood finishes", "Woodcraft"],
  ["950031", "Italian Pu Matt", "Wood finishes", "Woodcraft"],
  ["950034", "Italian Pu Gloss", "Wood finishes", "Woodcraft"],
  ["950032", "It Pu Matt Base", "Wood finishes", "Woodcraft"],
  ["950033", "It Pu Matt Hardener", "Wood finishes", "Woodcraft"],
  ["970901", "Stainer", "Stainers", "Colorants"],
  ["970902", "Stainer", "Stainers", "Colorants"],
  ["970903", "Stainer", "Stainers", "Colorants"],
  ["970904", "Stainer", "Stainers", "Colorants"],
  ["970905", "Stainer", "Stainers", "Colorants"],
  ["970906", "Stainer", "Stainers", "Colorants"],
  ["970038", "Stainer Fast Yellow Green", "Stainers", "Colorants"],
  ["970040", "Stainer Burnt Sienna", "Stainers", "Colorants"],
  ["970039", "Stainer", "Stainers", "Colorants"],
  ["970041", "Stainer", "Stainers", "Colorants"],
  ["970042", "Stainer", "Stainers", "Colorants"],
  ["930003", "Inspire Concrete", "Exterior Emulsions", "One"],
  // page 5
  ["931001", "True Look", "Exterior Emulsions", "One"],
  ["931009", "TRUE LOOK SHINE", "Exterior Emulsions", "One"],
  ["931002", "True Flex", "Exterior Emulsions", "One"],
  ["931003", "True Life", "Exterior Emulsions", "One"],
  ["931004", "True Vision", "Exterior Emulsions", "One"],
  ["931005", "Inspire Clear Coat", "Exterior Emulsions", "One"],
  ["940001", "Dream Effects", "Interior Emulsions", "One"],
  ["940002", "Dream Effects Metallic", "Interior Emulsions", "One"],
  ["940003", "Dream Marble", "Interior Emulsions", "One"],
  ["940004", "Dream Texture", "Interior Emulsions", "One"],
  ["940005", "Dream Duracoat", "Interior Emulsions", "One"],
  ["940101", "Timeless Stone", "Interior Emulsions", "One"],
  ["940102", "Timeless Natura", "Interior Emulsions", "One"],
  ["940103", "Timeless Clay", "Interior Emulsions", "One"],
  ["940104", "Timeless Marmarino", "Interior Emulsions", "One"],
  ["940105", "Timeless Marmarino Metallic", "Interior Emulsions", "One"],
  ["941001", "Pure Elegance", "Interior Emulsions", "One"],
  ["941002", "Pure Elegance Shine", "Interior Emulsions", "One"],
  ["941003", "Pure Elegance Matte", "Interior Emulsions", "One"],
  ["941004", "Pure Legend", "Interior Emulsions", "One"],
  ["941014", "Pure Elegance Soft", "Interior Emulsions", "One"],
  ["970021", "Stainers", "Stainers", "Stainers"],
  ["970017", "Style Stainer Black", "Stainers", "Stainers"],
  ["970018", "Style Stainer Fast Blue", "Stainers", "Stainers"],
  ["970019", "Style Stainer Fast Green", "Stainers", "Stainers"],
  ["970020", "Style Stainer Fast Red", "Stainers", "Stainers"],
  ["970022", "Style Stainer Fast Yellow", "Stainers", "Stainers"],
  ["970023", "Style Stainer Red Oxide", "Stainers", "Stainers"],
  ["970024", "Style Stainer Yellow Oxide", "Stainers", "Stainers"],
  ["944002", "Wallpaper", "Wallpaper", "Wallpaper"],
  ["944001", "Wallpaper", "Wallpaper", "Wallpaper"],
  ["945010", "Wallpaper", "Wallpaper", "Wallpaper"],
  ["945020", "Wallpaper", "Wallpaper", "Wallpaper"],
  ["945021", "Wallpaper", "Wallpaper", "Wallpaper"],
  ["945022", "Wallpaper", "Wallpaper", "Wallpaper"],
  ["945040", "Wallpaper", "Wallpaper", "Wallpaper"],
  ["945050", "Wallpaper", "Wallpaper", "Wallpaper"],
  ["945060", "Wallpaper", "Wallpaper", "Wallpaper"],
  ["945070", "Wallpaper", "Wallpaper", "Wallpaper"],
  ["945011", "Wallpaper", "Wallpaper", "Wallpaper"],
  ["945030", "Wallpaper", "Wallpaper", "Wallpaper"],
  ["945031", "Wallpaper", "Wallpaper", "Wallpaper"],
  ["945061", "Wallpaper", "Wallpaper", "Wallpaper"],
  ["945071", "Wallpaper", "Wallpaper", "Wallpaper"],
  ["945100", "Wallpaper", "Wallpaper", "Wallpaper"],
  // page 6
  ["945161", "Wallpaper", "Wallpaper", "Wallpaper"],
  ["945162", "Wallpaper", "Wallpaper", "Wallpaper"],
  ["945170", "Wallpaper", "Wallpaper", "Wallpaper"],
  ["945171", "Wallpaper", "Wallpaper", "Wallpaper"],
  ["945172", "Wallpaper", "Wallpaper", "Wallpaper"],
  ["945212", "Wallpaper", "Wallpaper", "Wallpaper"],
  ["945160", "Wallpaper", "Wallpaper", "Wallpaper"],
  ["945110", "Wallpaper", "Wallpaper", "Wallpaper"],
  ["945012", "Wallpaper", "Wallpaper", "Wallpaper"],
  ["945270", "Wallpaper", "Wallpaper", "Wallpaper"],
  ["945014", "Wallpaper", "Wallpaper", "Wallpaper"],
  ["945192", "100044EH One Heritage EsHo Roll-57sqft", "Wallpaper", "Wallpaper"],
  ["945023", "Fab100082", "Wallpaper", "Wallpaper"],
  ["945150", "Fab100038", "Wallpaper", "Wallpaper"],
  ["945033", "100047Eh", "Wallpaper", "Wallpaper"],
  ["945027", "100101 One Geo BO Roll-57sqft", "Wallpaper", "Wallpaper"],
  ["945153", "100047 One Tim BO Roll-57sqft", "Wallpaper", "Wallpaper"],
  ["945173", "Fab100018", "Wallpaper", "Wallpaper"],
  ["945151", "Fab100039", "Wallpaper", "Wallpaper"],
  ["945174", "Fab100023", "Wallpaper", "Wallpaper"],
  ["945024", "100085 One Geo BO Roll-57sqft", "Wallpaper", "Wallpaper"],
  ["945152", "100046 One Tim BO Roll-57sqft", "Wallpaper", "Wallpaper"],
  ["945155", "100056 One Tim BO Roll-57sqft", "Wallpaper", "Wallpaper"],
  ["945156", "100062 One Tim BO Roll-57sqft", "Wallpaper", "Wallpaper"],
  ["945190", "100023Eh", "Wallpaper", "Wallpaper"],
  ["945154", "Fab100051", "Wallpaper", "Wallpaper"],
  ["945175", "Fab100029", "Wallpaper", "Wallpaper"],
  ["945157", "Fab100063", "Wallpaper", "Wallpaper"],
  ["945026", "Fab100094", "Wallpaper", "Wallpaper"],
  ["945025", "Wallpaper", "Wallpaper", "Wallpaper"],
];

const PREMIUM: Row[] = [
  // page 6
  ["936003", "WallnRoof 10", "Water Proofing", "Drycoat"],
  ["936004", "WallnRoof 12", "Water Proofing", "Drycoat"],
  ["936012", "Wallnroof 14", "Water Proofing", "Drycoat"],
  ["953004", "PU Thinner", "Wood finishes", "Woodcraft"],
  ["953005", "Slow Drying PU Thinner", "Wood finishes", "Woodcraft"],
  ["517219", "Slow Dry Pu Thinner", "Wood finishes", "Woodcraft"],
  ["932002", "Neo Star", "Exterior Emulsions", "Lumina"],
  // page 7
  ["932003", "Neo Star Shine", "Exterior Emulsions", "Lumina"],
  ["932004", "Neo Floor Shade", "Exterior Emulsions", "Lumina"],
  ["932005", "Neo Tile Shade", "Exterior Emulsions", "Lumina"],
  ["942001", "Ever Stay", "Interior Emulsions", "Lumina"],
  ["942002", "Ever Wash", "Interior Emulsions", "Lumina"],
  ["942003", "Ever Wash Shine", "Interior Emulsions", "Lumina"],
  ["942004", "Ever Clear Matte", "Interior Emulsions", "Lumina"],
  ["942005", "Ever Clear", "Interior Emulsions", "Lumina"],
  ["932008", "Alpha Neo Star", "Exterior Emulsions", "Lumina"],
  ["942013", "Alpha Ever Wash", "Interior Emulsions", "Lumina"],
  ["932009", "Alpha Neo Star Shine", "Exterior Emulsions", "Lumina"],
  ["932007", "NEO KING", "Exterior Emulsions", "Lumina"],
  ["916070", "E70", "Institutional", "Prime"],
  ["916090", "E90", "Institutional", "Prime"],
  ["916071", "Prime E70", "Institutional", "Prime"],
  ["919008", "P1K 09 Prime", "Institutional", "Prime"],
  // code not in circular, matched from product master (Testdb.test_product baseproductname "EV50" -> 917052, 16-10-2026)
  ["917052", "EV50", "Institutional", "Prime"],
];

const ECONOMY: Row[] = [
  // page 7
  ["936001", "Salt Seal", "Water Proofing", "Drycoat"],
  ["936002", "WallFix 4", "Water Proofing", "Drycoat"],
  ["971001", "Total 2K", "Water Proofing", "Drycoat"],
  ["971002", "Total 2K Flex", "Water Proofing", "Drycoat"],
  ["971004", "Repair Master", "Water Proofing", "Drycoat"],
  ["936009", "Wallnroof 7", "Water Proofing", "Drycoat"],
  ["936011", "Total Win", "Water Proofing", "Drycoat"],
  ["951004", "Melamine Ultra Clear Sealer", "Wood finishes", "Woodcraft"],
  ["951005", "Melamine Ultra Clear Matte", "Wood finishes", "Woodcraft"],
  ["951006", "Melamine Ultra Clear Gloss", "Wood finishes", "Woodcraft"],
  ["951800", "Melamine Sealer", "Wood finishes", "Woodcraft"],
  ["951801", "Melamine Matte", "Wood finishes", "Woodcraft"],
  ["951802", "Melamine Gloss", "Wood finishes", "Woodcraft"],
  ["952830", "Softtouch Gloss", "Wood finishes", "Woodcraft"],
  ["952831", "Softtouch Matte", "Wood finishes", "Woodcraft"],
  ["910050", "I50", "Institutional", "Prime"],
  ["916050", "E50", "Institutional", "Prime"],
  ["918170", "B70", "Institutional", "Prime"],
  ["918190", "B90", "Institutional", "Prime"],
  ["922170", "Bv70", "Institutional", "Prime"],
  ["933020", "Power Bright", "Exterior Emulsions", "Style"],
  ["933022", "Power Bright Shine", "Exterior Emulsions", "Style"],
  ["943200", "Color Smart", "Interior Emulsions", "Style"],
  ["943201", "Color Smart Shine", "Interior Emulsions", "Style"],
  ["933023", "Alpha Power Bright", "Exterior Emulsions", "Style"],
  ["943202", "Alpha Color Smart", "Interior Emulsions", "Style"],
  ["917051", "EX50 White Prime", "Institutional", "Prime"],
  ["919020", "PPSB 22 Prime PPS Base", "Institutional", "Prime"],
  ["919021", "PPSH 22 Prime PPS Hardener", "Institutional", "Prime"],
];

const ENAMELS: Row[] = [
  // page 8
  ["961001", "Sparkle Gloss", "Enamel", "Lumina"],
  ["961002", "Sparkle Satin", "Enamel", "Lumina"],
  ["961003", "Sparkle Wood Primer", "Primer", "Lumina"],
  ["961004", "Pro White Cement ST Primer", "Primer", "Lumina"],
  ["961008", "Sparkle RO Primer", "Primer", "Lumina"],
  ["961009", "Sparkle PU", "Enamel", "Lumina"],
  ["961010", "Sparkle YO Primer", "Primer", "Lumina"],
  ["961005", "Lustre Finish", "Enamel", "Lumina"],
  ["961006", "Aluminium Paint", "Enamel-Others", "Lumina"],
  ["963002", "Clear Synthetic Varnish", "Enamel-Others", "Lumina"],
  ["960002", "1K Epoxy Primer", "Enamel-Others", "Lumina"],
  ["963001", "Knifing Paste Filler", "Enamel-Others", "Lumina"],
  ["960004", "Aerosol", "Enamel", "One"],
  ["962001", "Cover Max Gloss", "Enamel", "Style"],
  ["962002", "Pro Hide Cement ST Primer", "Primer", "Style"],
  ["962005", "Cover Max RO Primer", "Primer", "Style"],
];

const OTHERS: Row[] = [
  // page 8
  ["953006", "Wood Filler Teak", "Wood finishes", "Woodcraft"],
  ["953014", "Wood Filler Walnut", "Wood finishes", "Woodcraft"],
  ["953015", "Wood Filler White", "Wood finishes", "Woodcraft"],
  ["517179", "Pu Thinner", "Wood finishes", "Woodcraft"],
  ["953021", "WOOD FILLER WHITE", "Wood finishes", "Woodcraft"],
  ["932001", "Perfect Choice Primer", "Primer", "Lumina"],
  ["942006", "Pro White Primer", "Primer", "Lumina"],
  ["941005", "Pro Smooth Primer", "Primer", "One"],
  ["941006", "Pro Smooth Putty", "Interior Emulsions", "One"],
  ["941800", "Pro Primer And Putty", "Primer", "One"],
  ["933001", "Perfect Start Primer", "Primer", "Style"],
  ["933021", "Power Fit", "Exterior Emulsions", "Style"],
  ["943100", "Color Fresh", "Interior Emulsions", "Style"],
  ["943700", "Pro Hide Primer", "Primer", "Style"],
  ["943701", "Pro Fresh Primer", "Primer", "Style"],
];

const EMULSION_CATEGORIES = new Set(["Interior Emulsions", "Exterior Emulsions"]);

/** Channel 12 rule (see file header). Exported for tests and for the later template upload. */
export function isChannel12Eligible(p: { productName: string; productCategory: string; brand: string }): boolean {
  if (p.brand !== "One") return false;
  if (!EMULSION_CATEGORIES.has(p.productCategory)) return false;
  return !/putty|primer/i.test(p.productName);
}

function build(rows: Row[], starCategory: StarCategory): GtProduct[] {
  return rows.map(([productCode, productName, productCategory, brand]) => ({
    productCode,
    productName,
    productCategory,
    brand,
    starCategory,
    channel12Eligible: isChannel12Eligible({ productName, productCategory, brand }),
  }));
}

export const SP_PRODUCTS: GtProduct[] = [
  ...build(LUXURY, "LUXURY"),
  ...build(PREMIUM, "PREMIUM"),
  ...build(ECONOMY, "ECONOMY"),
  ...build(ENAMELS, "ENAMELS"),
  ...build(OTHERS, "OTHERS"),
];

/** Product code → product (one row per code). */
export const SP_PRODUCT_BY_CODE: ReadonlyMap<string, GtProduct> = new Map(SP_PRODUCTS.map((p) => [p.productCode, p]));
