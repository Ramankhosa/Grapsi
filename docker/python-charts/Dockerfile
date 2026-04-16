FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    fonts-liberation fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY server.py .
COPY templates/ templates/

EXPOSE 5100

CMD ["gunicorn", "--bind", "0.0.0.0:5100", "--workers", "2", "--timeout", "60", "server:app"]
