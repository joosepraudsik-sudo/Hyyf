"""Study areas: the test sheet and small windows around validation points.

Map sheet numbering (L-EST97, km):
  1:20 000  r c t u: r = (N - 6000) div 100 + 1, c = E div 100 - 2, t = N mod 100 div 10, u = E mod 100 div 10
  1:10 000  1:20 000 number + quarter 1 SW, 2 SE, 3 NW, 4 NE (checked from the test sheet GeoTIFF bounds)
"""
from dataclasses import dataclass
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent


@dataclass(frozen=True)
class Ala:
    nimi: str            # suffix of output files, e.g. "5458" -> valjund/sobivus_5458.tif
    x0: int
    y0: int
    x1: int
    y1: int
    kaust: str           # data folder under andmed/
    valjund_alam: str = ""
    korgus_kaust: str = ""  # shared height data folder under andmed/ (default: <dir>/korgus)

    @property
    def dir(self) -> Path:
        return BASE / "andmed" / self.kaust

    @property
    def korgus(self) -> Path:
        return BASE / "andmed" / self.korgus_kaust if self.korgus_kaust else self.dir / "korgus"

    @property
    def grid(self) -> Path:
        return self.dir / "ruudustik"

    @property
    def valjund(self) -> Path:
        return BASE / "valjund" / self.valjund_alam

    @property
    def bbox(self):
        return (self.x0, self.y0, self.x1, self.y1)


TESTALA = Ala("5458", 680000, 6450000, 690000, 6460000, "testala_5458")


def punkti_ala(nimi, x, y, pool=1500):
    """Square window of 2 x pool metres around a point, snapped to the 10 m grid."""
    cx, cy = round(x / 10) * 10, round(y / 10) * 10
    return Ala(nimi, cx - pool, cy - pool, cx + pool, cy + pool, f"kontroll/{nimi}", "kontroll")


def leht_20k(e_km, n_km):
    return f"{(n_km - 6000) // 100 + 1}{e_km // 100 - 2}{(n_km % 100) // 10}{(e_km % 100) // 10}"


def lehed_20k(ala):
    """1:20 000 sheets (10 km) that intersect the area."""
    out = []
    for n in range(ala.y0 // 10000 * 10, (ala.y1 - 1) // 10000 * 10 + 1, 10):
        for e in range(ala.x0 // 10000 * 10, (ala.x1 - 1) // 10000 * 10 + 1, 10):
            out.append(leht_20k(e, n))
    return out


def lehed_10k(ala):
    """1:10 000 sheets (5 km quarters) that intersect the area."""
    out = []
    for n in range(ala.y0 // 5000 * 5, (ala.y1 - 1) // 5000 * 5 + 1, 5):
        for e in range(ala.x0 // 5000 * 5, (ala.x1 - 1) // 5000 * 5 + 1, 5):
            q = 1 + ((e % 10) >= 5) + 2 * ((n % 10) >= 5)
            out.append(leht_20k(e, n) + str(q))
    return out
