"""Site model v0 parameters for Cantharellus cibarius (harilik kukeseen).

Expert-knowledge hypotheses only - user's own finds are NOT used here (validation later).
All scores are 0..1, 1 = optimal.
"""

# Host tree suitability by species (metsaregister puuliik_kood).
# Best: pine-dominated mixed forest with scattered spruce and/or birch (more host roots, dappled
# light). Pure pine very good; pure spruce weaker (dark, needle litter, poor ground vegetation).
PUULIIK = {
    "MA": 0.95, "KU": 0.75, "KS": 0.70, "TA": 0.60, "LH": 0.50, "HB": 0.40,
    "NU": 0.50, "TS": 0.50, "SD": 0.60, "PN": 0.30, "SA": 0.20, "VA": 0.20,
    "JA": 0.20, "LV": 0.20, "LM": 0.15, "RE": 0.10, "PP": 0.20,
}
PUULIIK_MUU = 0.20
SEGU_BOONUS = 0.10        # >= 2 host species (score >= 0.6) each >= SEGU_MIN %
SEGU_MIN = 10             # "scattered" admixture is enough
TEINE_RINNE_KAAL = 0.3    # weight of the 2nd storey relative to the 1st

# Forest site type (kasvukoht_kood): (suitability, water regime class)
# Water regime: 1 dry, 2 fresh, 3 moist, 4 wet (paludified / mire), 5 drained peat
KASVUKOHT = {
    # dry, poor - lichen (Cladonia) and heather heaths too dry and sun-exposed; cowberry heath best
    "SM": (0.45, 1), "KN": (0.50, 1), "PH": (1.00, 1), "LL": (0.50, 1),
    # fresh, mesotrophic - optimum
    "MS": (1.00, 2), "JP": (0.95, 2), "JM": (0.80, 2), "KL": (0.45, 2),
    # fresh, fertile - lush herb layer, more nitrogen
    "JK": (0.50, 2), "SL": (0.40, 2), "ND": (0.25, 2), "LU": (0.35, 2), "MP": (0.40, 2),
    # moist mineral
    "KM": (0.60, 3), "SN": (0.30, 3), "KR": (0.35, 3), "SJ": (0.20, 3),
    "OS": (0.15, 3), "TR": (0.15, 3), "AN": (0.15, 3), "TA": (0.10, 3),
    # drained peat
    "MO": (0.45, 5), "JO": (0.30, 5), "TP": (0.20, 5),
    # mires and swamp forests
    "LD": (0.05, 4), "MD": (0.05, 4), "SS": (0.05, 4), "RB": (0.02, 4),
}
KASVUKOHT_PUUDUB = (0.40, 2)

# Stand age (years) -> score. Chanterelles start fruiting in 20-30 y pine stands, but the
# mycelium network needs decades to become productive: full score from 40 y.
VANUS = [(0, 0.0), (15, 0.0), (40, 1.0), (120, 1.0), (180, 0.7), (300, 0.7)]

# Canopy cover (fraction > 5 m in 30 m window), split in two:
#   VALGUS  limiting: no trees (clearcut, open land) -> near zero
#   TIHEDUS preference: medium cover best, very dense somewhat worse
VALGUS = [(0.0, 0.05), (0.15, 0.05), (0.40, 1.0), (1.0, 1.0)]
TIHEDUS = [(0.0, 1.0), (0.80, 1.0), (1.0, 0.75)]

# Topographic wetness index -> score (micro-moisture); very wet hollows are poor
# optimum ~8.6; below 6.5 droughty ridges, above 11 hollows and ditch bottoms
TWI = [(0, 0.60), (6.5, 0.65), (7.3, 1.0), (10.0, 1.0), (11.0, 0.6), (30, 0.5)]

# Forest continuity: share of land with trees (> 5 m, cover > 0.3) within SIDUSUS_RAADIUS.
# Large continuous forest keeps a stable microclimate; small patches by fields and roads dry out.
SIDUSUS_RAADIUS = 300    # m
SIDUSUS = [(0.0, 0.5), (0.25, 0.5), (0.75, 1.0), (1.0, 1.0)]

# Ecotone: distance (m) from a mire / peat area. Mineral forest next to a mire keeps air humidity
# (night fog) while roots still get oxygen. Wet areas = mire site types (regime 4) + peat soils.
OKOTOON = [(0, 0.8), (20, 1.0), (200, 1.0), (400, 0.7), (100000, 0.7)]
TWI_MARJEM = 12.5   # above: water regime one class wetter
TWI_KUIVEM = 5.5    # below: one class drier

# Soil texture of the fine earth (mullakaart Lihtloimis): well-drained is best.
# l liiv, sl saviliiv, ls liivsavi, s savi, t turvas
LOIMIS = {"l": 1.00, "pl": 1.00, "sl": 0.90, "plsl": 0.90, "tsl": 0.85,
          "ls": 0.65, "tls": 0.60, "s": 0.35, "t": 0.30}
LOIMIS_MUU = 0.60
KARBONAATNE_KORES = 0.85   # v, r, k, p, pk, lu, + in texture formula -> less acidic

# Soil name (Sif1) -> wetness and acidity scores
MULD_TURVAS = 0.10         # M, S, R ... peat soils
MULD_GLEI = 0.35           # G* gleimullad
MULD_GLEISTUNUD_G = 0.50   # LG, LkG, LPG ... gley variants
MULD_GLEISTUNUD = 0.75     # ...g
MULD_NORK_GLEI = 0.90      # ...(g)
MULD_HAPE = {"K": 0.60, "KI": 0.85, "L": 1.00, "E": 0.95, "G": 0.85, "D": 0.85, "A": 0.70}
# soil score = wetness^a x texture^b x acidity^c (wetness matters most)
MULD_ASTMED = {"niiskus": 0.45, "loimis": 0.35, "hape": 0.20}

# ================= Dynamic moisture and fruiting model =================

# Soil water bucket per water regime class:
#   kp   plant-available water capacity of the mycelium / root zone, mm
#   pohi groundwater floor as fraction of kp (capillary rise keeps storage above it)
#   tous daily rate at which storage relaxes towards the floor when below it
#   marg score of a saturated bucket (waterlogging hurts wet sites, not sands that drain)
VEEREZIIM = {
    1: dict(nimi="kuiv", kp=45, pohi=0.00, tous=0.00, marg=1.00),
    2: dict(nimi="värske", kp=80, pohi=0.15, tous=0.02, marg=0.95),
    3: dict(nimi="niiske", kp=110, pohi=0.40, tous=0.05, marg=0.75),
    4: dict(nimi="märg", kp=140, pohi=0.70, tous=0.10, marg=0.40),
    5: dict(nimi="kuivendatud turvas", kp=120, pohi=0.35, tous=0.04, marg=0.70),
}
VAHETUS = 0.20          # canopy interception: share of daily rain ...
VAHETUS_MAX = 2.5       # ... up to this many mm/day
KC = 0.85               # forest-floor evapotranspiration = KC * ET0 * stress
KC_STRESS = 0.5         # below this relative storage, evapotranspiration declines linearly

# Relative storage w (0..1) -> moisture score for fruiting (saturated end set per class 'marg')
NIISKUS = [(0.0, 0.0), (0.20, 0.0), (0.45, 1.0), (0.90, 1.0)]

# Season (hooaeg): degree days above 5 C since 1 Jan, and moisture of 6-13 weeks before
KRAADIPAEV_ALUS = 5.0
HOOAEG_KP = [(0, 0.0), (450, 0.0), (750, 1.0)]      # roughly late June -> mid July
HOOAEG_NIISKUS_AKEN = (91, 42)                       # days back: from, to
HOOAEG_NIISKUS = [(0.0, 0.3), (0.25, 0.3), (0.55, 1.0), (1.0, 1.0)]

# Initiation (hoovõtt): wetting pulse or sustained good moisture, scaled by temperature
TOUKE_DW = 0.30          # rise of w over 3 days that counts as a full pulse
TOUKE_PUSIV = 0.30       # initiation from sustained good moisture without a pulse
ALGUS_TEMP = [(-10, 0.0), (9, 0.0), (14, 1.0), (22, 1.0), (27, 0.2), (40, 0.0)]  # Tmean, C
# Soil temperature (0-7 cm, 5-day mean): primordia need warm soil; ends the season in autumn
MULLA_TEMP = [(-10, 0.0), (10, 0.0), (14, 1.0), (40, 1.0)]
MULLA_TEMP_AKEN = 5

# Delay from initiation to mature fruit bodies: thermal time above 4 C
VIIVITUS_ALUS = 4.0
VIIVITUS_KP = 170        # ~ 12 days at 18 C, ~ 28 days at 10 C
VIIVITUS_MAX = 30        # days; primordia not mature by then are lost (autumn cold)

# Fruit bodies (viljakeha): daily survival of the standing crop
ELU_PAEV = 0.93          # half-life ~ 10 days in good conditions
ELU_POUD = 0.88          # when w below 0.2 (tolerates moderate drought)
ELU_JAHE = 0.88          # when Tmean below JAHE_PIIR: no growth, fruit bodies age and rot
JAHE_PIIR = 10.0
ELU_KULM = 0.50          # frost: Tmin below KULM_PIIR
KULM_PIIR = -1.5
INDEKS_SKAALA = 6.0     # index = min(1, crop / INDEKS_SKAALA); linear so halving the crop halves it

# Suitability = limiting factors (multiplied) x forest points. Forest points are additive: each
# factor gives at most its weight in points (weights sum to 1 = 100 points), easy to explain.
# Limiting: without a host tree of fruiting age under some canopy there are no chanterelles,
# however good the soil. Exponent < 1 softens the host score (spruce 0.75 -> 0.81).
PIIRAVAD = {
    "puuliik": 0.75,
    "vanus": 1.0,
    "valgus": 1.0,
}
KAALUD = {
    "kasvukoht": 0.36,
    "muld": 0.24,
    "mikroniiskus": 0.12,
    "okotoon": 0.10,
    "sidusus": 0.09,
    "tihedus": 0.09,
}
