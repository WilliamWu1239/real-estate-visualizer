import requests
from PIL import Image, ImageDraw
import io
import time

def create_test_data():
    # 2048x2048 image
    img = Image.new("RGB", (2048, 2048), color="gray")
    # Mask: small 200x200 box in center
    mask = Image.new("L", (2048, 2048), color=0)
    draw = ImageDraw.Draw(mask)
    draw.rectangle([924, 924, 1124, 1124], fill=255)
    
    img_byte_arr = io.BytesIO()
    img.save(img_byte_arr, format='PNG')
    img_bytes = img_byte_arr.getvalue()
    
    mask_byte_arr = io.BytesIO()
    mask.save(mask_byte_arr, format='PNG')
    mask_bytes = mask_byte_arr.getvalue()
    
    return img_bytes, mask_bytes

def test_edit():
    print("Generating test data...")
    img_bytes, mask_bytes = create_test_data()
    
    url = "http://127.0.0.1:8000/api/edit"
    files = {
        'image': ('test_image.png', img_bytes, 'image/png'),
        'mask': ('test_mask.png', mask_bytes, 'image/png'),
    }
    data = {
        'prompt': 'black tiles',
        'negative_prompt': 'blurry, pixelated',
        'guidance_scale': 7.5,
        'strength': 1.0,
        'seed': 42
    }
    
    print("Sending request...")
    for i in range(12): # Retry for 60s
        try:
            response = requests.post(url, files=files, data=data)
            if response.status_code == 200:
                with open('test_result.png', 'wb') as f:
                    f.write(response.content)
                print("Success! Saved test_result.png")
                return
            else:
                print(f"Error: {response.status_code} - {response.text}")
                return
        except requests.exceptions.ConnectionError:
            print(f"Connection failed, retrying in 5s... ({i+1}/12)")
            time.sleep(5)
        except Exception as e:
            print(f"Error: {e}")
            return
    print("Failed to connect after 60s")

if __name__ == "__main__":
    # Wait for server to start
    # time.sleep(5) 
    test_edit()
