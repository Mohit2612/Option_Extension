import zlib
import struct
import math

def make_png(size, filename):
    # Generates a polished icon: dark radial background with cyan/emerald candlesticks and an AI radar crosshair
    width = size
    height = size
    raw_data = bytearray()
    
    cx = width / 2.0
    cy = height / 2.0
    radius = width * 0.46

    for y in range(height):
        raw_data.append(0)  # Filter type 0 (None)
        for x in range(width):
            dx = x - cx
            dy = y - cy
            dist = math.hypot(dx, dy)
            
            # Base background: rounded squircle with gradient
            # Superellipse shape (|dx/r|^4 + |dy/r|^4 <= 1)
            squircle = (abs(dx / radius) ** 4 + abs(dy / radius) ** 4)
            
            if squircle > 1.05:
                # Outside
                raw_data.extend([0, 0, 0, 0])
                continue
            
            # Anti-aliased border
            alpha = 255
            if squircle > 0.92:
                alpha = int(255 * (1.05 - squircle) / 0.13)
                alpha = max(0, min(255, alpha))

            # Dark modern background (dark slate/navy gradient)
            bg_r = int(14 + (y / height) * 10)
            bg_g = int(18 + (y / height) * 15)
            bg_b = int(28 + (y / height) * 20)

            # Draw AI chart elements:
            # Candlestick 1: Bullish (Green #00E676)
            c1_x1 = int(width * 0.28)
            c1_x2 = int(width * 0.42)
            c1_top = int(height * 0.38)
            c1_bot = int(height * 0.68)
            c1_wick_top = int(height * 0.25)
            c1_wick_bot = int(height * 0.78)
            wick1_x = int((c1_x1 + c1_x2) / 2)

            # Candlestick 2: Bullish/Cyan (#00D4FF) higher high
            c2_x1 = int(width * 0.56)
            c2_x2 = int(width * 0.70)
            c2_top = int(height * 0.22)
            c2_bot = int(height * 0.50)
            c2_wick_top = int(height * 0.15)
            c2_wick_bot = int(height * 0.62)
            wick2_x = int((c2_x1 + c2_x2) / 2)

            # Draw Candlestick 1
            is_c1_body = (c1_x1 <= x <= c1_x2) and (c1_top <= y <= c1_bot)
            is_c1_wick = (abs(x - wick1_x) <= max(0, int(width * 0.02))) and (c1_wick_top <= y <= c1_wick_bot)
            
            # Draw Candlestick 2
            is_c2_body = (c2_x1 <= x <= c2_x2) and (c2_top <= y <= c2_bot)
            is_c2_wick = (abs(x - wick2_x) <= max(0, int(width * 0.02))) and (c2_wick_top <= y <= c2_wick_bot)

            # Target / AI Radar line
            is_ai_trend = abs((y - height * 0.72) + (x - width * 0.2) * 0.6) < max(1, width * 0.03) and (width * 0.18 <= x <= width * 0.82)

            if is_c2_body or is_c2_wick:
                r, g, b = 0, 212, 255  # Neon Cyan
            elif is_c1_body or is_c1_wick:
                r, g, b = 0, 230, 118  # Neon Emerald
            elif is_ai_trend:
                r, g, b = 255, 215, 0  # Gold trendline
            else:
                # Subtle radar grid circle
                if abs(dist - radius * 0.6) < 1.0 or abs(dist - radius * 0.3) < 0.8:
                    r, g, b = bg_r + 25, bg_g + 35, bg_b + 55
                else:
                    r, g, b = bg_r, bg_g, bg_b

            raw_data.extend([r, g, b, alpha])

    def chunk(chunk_type, data):
        return struct.pack('>I', len(data)) + chunk_type + data + struct.pack('>I', zlib.crc32(chunk_type + data) & 0xffffffff)

    png_header = b'\x89PNG\r\n\x1a\n'
    ihdr = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)
    idat = zlib.compress(bytes(raw_data), 9)
    
    with open(filename, 'wb') as f:
        f.write(png_header)
        f.write(chunk(b'IHDR', ihdr))
        f.write(chunk(b'IDAT', idat))
        f.write(chunk(b'IEND', b''))

make_png(16, 'icons/icon16.png')
make_png(48, 'icons/icon48.png')
make_png(128, 'icons/icon128.png')
print("Icons generated successfully.")
