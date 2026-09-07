from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parent
ASSETS = ROOT / "assets"
SCREENSHOT = ASSETS / "screenshots" / "03-add-to-product-1600x900.png"
OUTPUT = ASSETS / "feature-1600x900.png"

SCALE = 2
W, H = 1600 * SCALE, 900 * SCALE
FONT_ROOT = Path("/Users/sen/Desktop/lsl_code/.agents/skills/canvas-design/canvas-fonts")


def font(name: str, size: int):
    return ImageFont.truetype(str(FONT_ROOT / name), size * SCALE)


def rounded(draw, box, radius, fill, outline=None, width=1):
    box = tuple(int(value * SCALE) for value in box)
    draw.rounded_rectangle(
        box,
        radius=radius * SCALE,
        fill=fill,
        outline=outline,
        width=width * SCALE,
    )


def text(draw, xy, value, used_font, fill, anchor=None):
    draw.text(
        (xy[0] * SCALE, xy[1] * SCALE),
        value,
        font=used_font,
        fill=fill,
        anchor=anchor,
    )


def shadow_card(canvas, box, radius=28, shadow=(12, 8, 35, 95)):
    layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    layer_draw = ImageDraw.Draw(layer)
    x0, y0, x1, y1 = [int(v * SCALE) for v in box]
    layer_draw.rounded_rectangle(
        (x0 + 10 * SCALE, y0 + 18 * SCALE, x1 + 10 * SCALE, y1 + 18 * SCALE),
        radius=radius * SCALE,
        fill=shadow,
    )
    layer = layer.filter(ImageFilter.GaussianBlur(22 * SCALE))
    canvas.alpha_composite(layer)


canvas = Image.new("RGBA", (W, H), (25, 20, 52, 255))
pixels = canvas.load()
for y in range(H):
    for x in range(W):
        nx = x / W
        ny = y / H
        glow = max(0.0, 1.0 - (((nx - 0.7) / 0.65) ** 2 + ((ny - 0.4) / 0.8) ** 2))
        pixels[x, y] = (
            int(24 + 22 * glow),
            int(19 + 18 * glow),
            int(51 + 47 * glow),
            255,
        )

draw = ImageDraw.Draw(canvas)

# Quiet craft grid keeps the workflow grounded without becoming another focal point.
for x in range(74, 1560, 64):
    for y in range(80, 860, 64):
        r = 1 if (x + y) % 128 else 2
        draw.ellipse(
            ((x - r) * SCALE, (y - r) * SCALE, (x + r) * SCALE, (y + r) * SCALE),
            fill=(131, 116, 229, 55),
        )

# Title and benefit statement.
rounded(draw, (72, 58, 236, 92), 17, (113, 91, 222, 255))
text(draw, (154, 75), "AI BRAND STUDIO", font("RedHatMono-Bold.ttf", 12), "white", "mm")
text(draw, (72, 122), "FROM BRIEF", font("Outfit-Bold.ttf", 57), "white")
text(draw, (72, 180), "TO BRAND", font("Outfit-Bold.ttf", 57), (205, 193, 255, 255))
text(
    draw,
    (75, 256),
    "Describe the idea. Generate the mark.\nUse it on a product.",
    font("WorkSans-Regular.ttf", 21),
    (213, 207, 232, 255),
)

# Functional brief card.
brief_box = (72, 350, 650, 756)
shadow_card(canvas, brief_box)
draw = ImageDraw.Draw(canvas)
rounded(draw, brief_box, 28, (250, 249, 255, 255), (190, 177, 247, 255), 1)
text(draw, (112, 392), "1  BRAND BRIEF", font("RedHatMono-Bold.ttf", 14), (93, 70, 193, 255))
text(draw, (112, 433), "Give the logo a clear direction", font("Outfit-Bold.ttf", 27), (35, 29, 64, 255))
text(draw, (112, 492), "BRAND NAME", font("RedHatMono-Bold.ttf", 11), (99, 93, 116, 255))
rounded(draw, (112, 515, 610, 567), 12, (255, 255, 255, 255), (192, 186, 208, 255), 1)
text(draw, (132, 541), "Northstar Coffee", font("WorkSans-Regular.ttf", 17), (38, 34, 53, 255), "lm")
text(draw, (112, 596), "CREATIVE DIRECTION", font("RedHatMono-Bold.ttf", 11), (99, 93, 116, 255))
rounded(draw, (112, 619, 610, 681), 12, (255, 255, 255, 255), (192, 186, 208, 255), 1)
text(draw, (132, 650), "Mountain symbol · forest green · warm gold", font("WorkSans-Regular.ttf", 15), (38, 34, 53, 255), "lm")
rounded(draw, (112, 704, 610, 738), 17, (39, 33, 62, 255))
text(draw, (361, 721), "GENERATE LOGO", font("Outfit-Bold.ttf", 13), "white", "mm")

# Directional bridge between the brief and the finished asset.
draw.line(
    (674 * SCALE, 554 * SCALE, 750 * SCALE, 554 * SCALE),
    fill=(185, 168, 255, 255),
    width=4 * SCALE,
)
draw.polygon(
    [(750 * SCALE, 544 * SCALE), (772 * SCALE, 554 * SCALE), (750 * SCALE, 564 * SCALE)],
    fill=(185, 168, 255, 255),
)

# Result card uses the real generated logo captured from the working Shopify app.
result_box = (794, 88, 1527, 812)
shadow_card(canvas, result_box, shadow=(8, 5, 30, 120))
draw = ImageDraw.Draw(canvas)
rounded(draw, result_box, 32, (247, 245, 255, 255), (181, 164, 245, 255), 1)
text(draw, (842, 132), "2  READY-TO-USE RESULT", font("RedHatMono-Bold.ttf", 14), (93, 70, 193, 255))

source = Image.open(SCREENSHOT).convert("RGB")
logo = source.crop((872, 286, 1321, 718)).resize((490 * SCALE, 472 * SCALE), Image.Resampling.LANCZOS)
logo = logo.convert("RGBA")
logo_shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
logo_shadow_draw = ImageDraw.Draw(logo_shadow)
logo_shadow_draw.rounded_rectangle(
    (904 * SCALE, 188 * SCALE, 1418 * SCALE, 700 * SCALE),
    radius=22 * SCALE,
    fill=(33, 25, 68, 70),
)
logo_shadow = logo_shadow.filter(ImageFilter.GaussianBlur(18 * SCALE))
canvas.alpha_composite(logo_shadow)
draw = ImageDraw.Draw(canvas)
rounded(draw, (886, 170, 1436, 720), 24, (255, 255, 255, 255))
canvas.alpha_composite(logo, (916 * SCALE, 205 * SCALE))
draw = ImageDraw.Draw(canvas)

rounded(draw, (854, 750, 1105, 790), 20, (229, 224, 252, 255))
text(draw, (979, 770), "DOWNLOAD", font("Outfit-Bold.ttf", 12), (59, 45, 116, 255), "mm")
rounded(draw, (1122, 750, 1483, 790), 20, (18, 137, 96, 255))
text(draw, (1302, 770), "✓  ADDED TO PRODUCT", font("Outfit-Bold.ttf", 12), "white", "mm")

canvas = canvas.convert("RGB").resize((1600, 900), Image.Resampling.LANCZOS)
canvas.save(OUTPUT, quality=96)
