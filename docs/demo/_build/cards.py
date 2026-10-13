"""Title cards for the pitch (brand: navy #04060f, royal-blue bloom, gold accents, white type)."""
import os, numpy as np
from PIL import Image, ImageDraw, ImageFont
HERE = os.path.dirname(os.path.abspath(__file__)); W = os.path.join(HERE, "work")
F = lambda n, s: ImageFont.truetype(os.path.join(HERE, "fonts", n), s)
VW, VH = 1920, 1080
def bg():
    yy, xx = np.mgrid[0:VH, 0:VW].astype(np.float32)
    d = np.sqrt(((xx - VW / 2) / (VW * 0.75)) ** 2 + ((yy + VH * 0.05) / (VH * 0.6)) ** 2)
    b = np.clip(1 - d, 0, 1) ** 1.5 * 0.34
    img = np.zeros((VH, VW, 3), np.float32)
    for k, (n, c) in enumerate(zip((4, 6, 15), (47, 71, 245))): img[..., k] = n * (1 - b) + c * b
    rng = np.random.default_rng(3)
    for _ in range(300):
        x, y = rng.integers(0, VW), rng.integers(0, VH); img[y, x] = np.minimum(255, img[y, x] + rng.integers(30, 110))
    return Image.fromarray(img.astype(np.uint8)).convert("RGBA")
GOLD = (242, 194, 122); MUTED = (190, 198, 230)
def card(name, kicker, head, rows):
    im = bg(); d = ImageDraw.Draw(im)
    d.text((160, 170), kicker.upper(), font=F("Satoshi-Black.ttf", 30), fill=GOLD)
    y = 230
    for line in head.split("\n"):
        d.text((160, y), line, font=F("Satoshi-Black.ttf", 84), fill=(255, 255, 255)); y += 100
    y += 40
    for big, small in rows:
        d.rounded_rectangle([160, y, 1760, y + 112], radius=22, fill=(10, 16, 40, 255), outline=(59, 85, 255, 160), width=2)
        d.text((200, y + 56), big, font=F("Satoshi-Black.ttf", 40), fill=GOLD, anchor="lm")
        d.text((200 + d.textlength(big, font=F("Satoshi-Black.ttf", 40)) + 30, y + 58), small, font=F("Satoshi-Medium.ttf", 30), fill=MUTED, anchor="lm")
        y += 132
    im.convert("RGB").save(os.path.join(W, name + ".png"))
card("card-whynow", "Why now", "Payments are moving on chain.\nNo one runs payroll in public.",
     [("Monad", "fast finality and low fees make payroll and checkout practical"), ("Today", "every transfer shows who paid whom, and how much"), ("Builders", "wallets and payment apps can't each build ZK and FHE")])
card("card-evidence", "Evidence · public testnets", "Live on Monad testnet today.",
     [("44 contracts", "verified: Monad 29/29, Sepolia 15/15 (Sourcify)"), ("Real transactions", "every live clip here was sent from a fresh recording wallet"), ("Anonymity set", "seeded by our team for the demo, not organic users")])
card("card-next", "Honest limits · what's next", "Decentralize the trust.",
     [("FHE key", "held by one hosted engine today; KMS signers in one service"), ("Attester", "Kakushi's runner using CRE workflow logic, not a DON"), ("Slashing", "tested end to end on a fork; no transfer has gone unpaid live")])
card("card-vision", "Vision", "Privacy as a plugin\nfor every Monad app.",
     [("ZK hides who", "stealth addresses, shielded pool, private bridge delivery"), ("FHE hides how much", "encrypted balances and payments"), ("One component", "<KakushiPay /> and the SDK, drop-in")])
print("cards ok")

def bounty(name, sponsor):
    im = bg(); d = ImageDraw.Draw(im)
    d.text((VW / 2, 470), f"{sponsor} bounty · Kakushi", font=F("Satoshi-Black.ttf", 92), fill=(255, 255, 255), anchor="mm")
    d.text((VW / 2, 580), "The privacy provider for Monad: ZK hides who, FHE hides how much.", font=F("Satoshi-Medium.ttf", 38), fill=GOLD, anchor="mm")
    im.convert("RGB").save(os.path.join(W, name + ".png"))
for n, s in [("card-bounty-cre", "Chainlink CRE"), ("card-bounty-privy", "Privy"), ("card-bounty-envio", "Envio")]:
    bounty(n, s)
