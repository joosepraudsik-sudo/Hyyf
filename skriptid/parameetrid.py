"""Site model v0 parameters for Cantharellus cibarius (harilik kukeseen).

Expert-knowledge hypotheses only - user's own finds are NOT used here (validation later).
All scores are 0..1, 1 = optimal.
"""

# Host tree suitability by species (metsaregister puuliik_kood).
# Pine best; spruce and birch good, especially in mixtures; oak and beech-family hosts fair.
PUULIIK = {
    "MA": 1.00, "KU": 0.75, "KS": 0.70, "TA": 0.60, "LH": 0.50, "HB": 0.40,
    "NU": 0.50, "TS": 0.50, "SD": 0.60, "PN": 0.30, "SA": 0.20, "VA": 0.20,
    "JA": 0.20, "LV": 0.20, "LM": 0.15, "RE": 0.10, "PP": 0.20,
}
PUULIIK_MUU = 0.20
SEGU_BOONUS = 0.10        # >= 2 host species (score >= 0.6) each >= 20 %
TEINE_RINNE_KAAL = 0.3    # weight of the 2nd storey relative to the 1st

# Forest site type (kasvukoht_kood): (suitability, water regime class)
# Water regime: 1 dry, 2 fresh, 3 moist, 4 wet (paludified / mire), 5 drained peat
KASVUKOHT = {
    # dry, poor - chanterelle classic pine heaths, but drought-prone
    "SM": (0.70, 1), "KN": (0.65, 1), "PH": (1.00, 1), "LL": (0.50, 1),
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

# Stand age (years) -> score, piecewise linear (young to maturing best)
VANUS = [(0, 0.0), (10, 0.0), (25, 1.0), (100, 1.0), (160, 0.6), (300, 0.6)]

# Canopy cover (fraction > 5 m in 30 m window) -> score: open to medium best
KATVUS = [(0.0, 0.10), (0.15, 0.10), (0.40, 1.0), (0.80, 1.0), (1.0, 0.75)]

# Topographic wetness index -> score (micro-moisture); very wet hollows are poor
TWI = [(0, 0.85), (6, 0.85), (7.5, 1.0), (10, 1.0), (13, 0.6), (30, 0.5)]
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

# Weights of the weighted geometric mean
KAALUD = {
    "puuliik": 0.25,
    "kasvukoht": 0.22,
    "vanus": 0.13,
    "muld": 0.15,
    "katvus": 0.15,
    "mikroniiskus": 0.10,
}
