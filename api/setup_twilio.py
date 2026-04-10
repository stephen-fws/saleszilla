"""One-time Twilio setup script.

Creates the API Key + TwiML App programmatically using the Twilio REST API.
Run once, copy the output values to your .env file.

Usage:
  cd api
  venv_saleszilla/Scripts/activate
  python setup_twilio.py

Requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_CALLING_NUMBER,
and BASE_URL to be set in .env already.
"""

import os
from dotenv import load_dotenv

load_dotenv()

ACCOUNT_SID = os.getenv("TWILIO_ACCOUNT_SID", "")
AUTH_TOKEN = os.getenv("TWILIO_AUTH_TOKEN", "")
BASE_URL = os.getenv("BASE_URL", "")

if not ACCOUNT_SID or not AUTH_TOKEN:
    print("ERROR: Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in .env first.")
    exit(1)

from twilio.rest import Client

client = Client(ACCOUNT_SID, AUTH_TOKEN)

app_name = input("Enter app name (e.g. Salezilla Beta, Salezilla Prod) [Salezilla]: ").strip() or "Salezilla"
base_url = input(f"Enter BASE_URL (public API URL for webhooks) [{BASE_URL or 'http://localhost:8000'}]: ").strip() or BASE_URL or "http://localhost:8000"
BASE_URL = base_url

print("=" * 60)
print(f"Twilio Setup for {app_name}")
print("=" * 60)

# 1. Create API Key (needed for Access Token generation)
print("\n1. Creating API Key...")
api_key = client.new_keys.create(friendly_name=f"{app_name} Voice SDK")
print(f"   TWILIO_API_KEY={api_key.sid}")
print(f"   TWILIO_API_SECRET={api_key.secret}")
print(f"   ⚠ Save the secret NOW — it won't be shown again!")

# 2. Create TwiML App (routes browser SDK calls to our voice webhook)
voice_url = f"{BASE_URL}/twilio/voice"
status_url = f"{BASE_URL}/twilio/status"
print(f"\n2. Creating TwiML App (Voice URL: {voice_url})...")
twiml_app = client.applications.create(
    friendly_name=f"{app_name} Voice",
    voice_url=voice_url,
    voice_method="POST",
    status_callback=status_url,
    status_callback_method="POST",
)
print(f"   TWILIO_TWIML_APP_SID={twiml_app.sid}")

# 3. Summary
print("\n" + "=" * 60)
print("Add these to your api/.env file:")
print("=" * 60)
print(f"TWILIO_API_KEY={api_key.sid}")
print(f"TWILIO_API_SECRET={api_key.secret}")
print(f"TWILIO_TWIML_APP_SID={twiml_app.sid}")
print("=" * 60)
print("\nDone! Restart the API server after updating .env.")
print(f"\nNote: If you change BASE_URL later (e.g. ngrok URL), update the")
print(f"TwiML App's Voice URL in Twilio Console or re-run this script.")
