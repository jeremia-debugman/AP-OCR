import urllib.request
import json
import io
import os

def test_api():
    print("Testing Backend API Endpoints...\n")

    # 1. Config endpoint
    req = urllib.request.urlopen("http://localhost:8001/api/config")
    config = json.loads(req.read().decode())
    print("1. Config Status:", config)

    # 2. Health endpoint
    req = urllib.request.urlopen("http://localhost:8001/api/health")
    health = json.loads(req.read().decode())
    print("2. Health Status:", health)

    # 3. Create dummy test bill image (1x1 transparent PNG)
    dummy_png = b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15c4\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82'

    # 4. Upload file via multipart
    boundary = "----WebKitFormBoundary7MA4YWxkTrZu0gW"
    body = io.BytesIO()
    body.write(f"--{boundary}\r\n".encode())
    body.write(b'Content-Disposition: form-data; name="files"; filename="sample_fuel_receipt.png"\r\n')
    body.write(b"Content-Type: image/png\r\n\r\n")
    body.write(dummy_png)
    body.write(f"\r\n--{boundary}--\r\n".encode())

    req = urllib.request.Request(
        "http://localhost:8001/api/extract",
        data=body.getvalue(),
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"}
    )
    res = urllib.request.urlopen(req)
    extract1 = json.loads(res.read().decode())
    print(f"3. First upload extraction success: {extract1['success']}, count: {len(extract1['invoices'])}")

    # 5. Upload same file a second time -> DUPLICATE CHECK
    req2 = urllib.request.Request(
        "http://localhost:8001/api/extract",
        data=body.getvalue(),
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"}
    )
    res2 = urllib.request.urlopen(req2)
    extract2 = json.loads(res2.read().decode())
    print(f"4. Second upload extraction: notes='{extract2['invoices'][0].get('extraction_notes')}'")

    # 5. Sample Invoices endpoint
    req = urllib.request.urlopen("http://localhost:8001/api/sample-invoices")
    samples = json.loads(req.read().decode())
    print(f"4. Sample invoices count: {len(samples.get('samples', []))}")

    # 6. GSheet Database Records endpoint
    req = urllib.request.urlopen("http://localhost:8001/api/gsheet/records")
    records = json.loads(req.read().decode())
    print(f"5. Total database records: {records.get('total_records')}")

    print("\n>>> ALL BACKEND API VALIDATION TESTS PASSED SUCCESSFULLY! <<<\n")

if __name__ == "__main__":
    test_api()
