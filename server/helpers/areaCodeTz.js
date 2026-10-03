// NANP area code → IANA time zone, so a call list can show the contact's local
// time from the phone number alone (works without a CRM). Area codes that
// straddle a zone boundary are mapped to where most of their population is;
// an optional region (US state / CA province, from Zoho) refines the few
// ambiguous ones. Unknown / non-NANP → null and the UI shows nothing.
const ET = 'America/New_York', CT = 'America/Chicago', MT = 'America/Denver', PT = 'America/Los_Angeles';
const AZ = 'America/Phoenix', AK = 'America/Anchorage', HI = 'Pacific/Honolulu', AT = 'America/Halifax';
const NL = 'America/St_Johns', SK = 'America/Regina', PR = 'America/Puerto_Rico';

const ZONES = {
  [ET]: [
    // CT DE DC
    203,475,860,959, 302, 202,771,
    // FL (peninsula)
    239,305,321,352,386,407,561,656,689,727,754,772,786,813,863,904,941,954,
    // GA
    229,404,470,478,678,706,762,770,912,943,
    // IN (Eastern parts)
    260,317,463,574,765,812,930,
    // KY (Eastern)
    502,606,859,
    // ME MD MA
    207, 240,301,410,443,667, 339,351,413,508,617,774,781,857,978,
    // MI
    231,248,269,313,517,586,616,679,734,810,906,947,989,
    // NH NJ
    603, 201,551,609,640,732,848,856,862,908,973,
    // NY
    212,315,332,347,363,516,518,585,607,631,646,680,716,718,838,845,914,917,929,934,
    // NC
    252,336,704,743,828,910,919,980,984,
    // OH
    216,220,234,283,326,330,380,419,440,513,567,614,740,937,
    // PA
    215,223,267,272,412,445,484,570,582,610,717,724,814,835,878,
    // RI SC
    401, 803,839,843,854,864,
    // TN (Eastern)
    423,865,
    // VT VA WV
    802, 276,434,540,571,703,757,804,826,948, 304,681,
    // Ontario + Quebec
    226,249,289,343,365,382,416,437,519,548,613,647,683,705,742,753,807,905,
    263,354,367,418,438,450,468,514,579,581,819,873,
  ],
  [CT]: [
    // AL AR
    205,251,256,334,659,938, 327,479,501,870,
    // FL panhandle
    850,448,
    // IL IN(NW) IA
    217,224,309,312,331,447,464,618,630,708,730,773,779,815,847,872, 219, 319,515,563,641,712,
    // KS KY(W) LA
    316,620,785,913, 270,364, 225,318,337,504,985,
    // MN MS MO
    218,320,507,612,651,763,952, 228,601,662,769, 314,417,557,573,636,660,816,975,
    // NE ND OK SD
    308,402,531, 701, 405,539,572,580,918, 605,
    // TN (Central) TX
    615,629,731,901,931,
    210,214,254,281,325,346,361,409,430,432,469,512,682,713,726,737,806,817,830,832,903,936,940,945,956,972,979,
    // WI, Manitoba
    262,274,414,534,608,715,920, 204,431,584,
  ],
  [MT]: [
    303,719,720,970,983, 208,986, 406, 505,575, 385,435,801, 307, 915,
    // Alberta
    403,587,780,825,368,
  ],
  [PT]: [
    209,213,279,310,323,341,350,369,408,415,424,442,510,530,559,562,619,626,628,650,657,661,669,
    707,714,747,760,805,818,820,831,840,858,909,916,925,949,951,
    702,725,775, 458,503,541,971, 206,253,360,425,509,564,
    // British Columbia
    236,250,604,672,778,
  ],
  [AZ]: [480,520,602,623,928],
  [AK]: [907],
  [HI]: [808],
  [AT]: [782,902,506,428],
  [NL]: [709],
  [SK]: [306,639,474],
  [PR]: [787,939],
};

const BY_CODE = new Map();
for (const [zone, codes] of Object.entries(ZONES)) for (const c of codes) BY_CODE.set(String(c), zone);

// Region overrides for codes that straddle zones (only when the CRM tells us).
const REGION_TZ = {
  AZ: AZ, HI: HI, AK: AK, SK: SK, NL: NL, PR: PR, NS: AT, NB: AT, PE: AT,
  FL: ET, IN: ET, KY: ET, MI: ET, TN: CT, TX: CT, KS: CT, NE: CT, ND: CT, SD: CT, ID: MT, OR: PT,
};

function tzForPhone(phone, region = null) {
  const digits = String(phone || '').replace(/\D/g, '');
  const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (ten.length !== 10) return null;
  const byCode = BY_CODE.get(ten.slice(0, 3)) || null;
  // A region only refines when the area code is one of the straddlers;
  // otherwise the area code wins (people keep numbers when they move, but
  // the CRM address is the better guess only when the code itself is split).
  const r = region ? String(region).trim().toUpperCase() : null;
  if (r && REGION_TZ[r] && SPLIT_CODES.has(ten.slice(0, 3))) return REGION_TZ[r];
  return byCode;
}

// Area codes known to cross a time-zone line.
const SPLIT_CODES = new Set(['850','812','219','270','906','308','605','701','208','432','541','807','867']);

module.exports = { tzForPhone };
