# SmartLead-Twenty Integration Service

This Node.js/TypeScript service listens for webhooks from SmartLead.ai and creates corresponding Company, Person, Opportunity, and Activity (Note) records in a self-hosted Twenty CRM instance.

## Purpose

The primary goal is to automatically ingest leads that have shown interest (e.g., category changed to "Interested", "Information Request", "Meeting Request") during a SmartLead campaign into the Twenty CRM pipeline.

## Functionality

1.  **Webhook Listener:** An Express server listens for incoming POST requests from SmartLead at the `/webhooks/smartlead` endpoint.
2.  **Webhook Validation (Optional):** If `SMARTLEAD_WEBHOOK_SECRET` is set in the environment, it validates the incoming webhook using this secret.
3.  **Interest Check:** Processes webhooks where `event_type` is `LEAD_CATEGORY_UPDATED` and the `lead_category.new_name` matches predefined positive categories ("Interested", "Information Request", "Meeting Request"). Other events/categories are ignored but acknowledged with a 200 OK.
4.  **Data Extraction:** Parses lead details (email, name, company, website, etc.) from the webhook payload.
5.  **Company Handling:** 
    *   Attempts to find an existing Company in Twenty based on website domain (if available) or company name.
    *   If not found, creates a new Company.
6.  **Person Handling:**
    *   Attempts to find an existing Person in Twenty based on email address.
    *   If not found, creates a new Person, linking them to the found/created Company.
7.  **Opportunity Creation:** Creates a new Opportunity in Twenty, linked to the Person and Company, setting the initial stage to `INTERESTED` (or the configured stage in the code).
8.  **Activity Logging:** Creates a Note activity in Twenty detailing the SmartLead event, linked to the Person, Company, and Opportunity.
9.  **API Interaction:** Uses GraphQL mutations (`createNote`, `createNoteTarget`, `createOpportunity`, `createPerson`, `createCompanies`) via the Twenty API, including retry logic for API calls.

## Setup

1.  **Clone:** Clone the main repository containing this service.
2.  **Navigate:** `cd smartlead-twenty-integration`
3.  **Install Dependencies:** `npm install`
4.  **Environment Variables:**
    *   Copy `.env.example` to `.env`.
    *   Open `.env` and fill in the required values:
        *   `TWENTY_API_URL`: URL for your Twenty GraphQL API (e.g., `http://localhost:3001/graphql` or the Render service URL).
        *   `TWENTY_API_TOKEN`: An API token generated from your Twenty instance (Settings > Developers).
    *   Optional values:
        *   `PORT`: Port for this service to listen on (defaults to 3002).
        *   `SMARTLEAD_WEBHOOK_SECRET`: A secret string to validate incoming webhooks. If set, this must also be configured in the SmartLead webhook settings.

## Running Locally

1.  **Build:** `npm run build`
2.  **Run:** `node dist/index.js`
    *   *Alternatively, for development with auto-restart:* `npm run dev` (Note: We encountered issues with nodemon exiting prematurely, `node dist/index.js` is more reliable currently).
3.  **Expose Endpoint:** Use a tool like `ngrok` to expose your local port (e.g., 3002) to the internet for testing SmartLead webhooks:
    *   Install ngrok authtoken (one-time setup).
    *   Run `ngrok http 3002`.
    *   Copy the `https://....ngrok-free.app` URL provided.
4.  **Configure SmartLead:** Set the SmartLead webhook URL to `https://....ngrok-free.app/webhooks/smartlead`, select the desired events (e.g., `LEAD_CATEGORY_UPDATED`), and optionally add the secret.

## Docker

A `Dockerfile` is included to build a container image for this service.

1.  **Build:** `docker build -t your-image-name .`
2.  **Run:** 
    ```bash
    docker run -p 3002:3002 \
      -e TWENTY_API_URL="<your_twenty_api_url>" \
      -e TWENTY_API_TOKEN="<your_twenty_token>" \
      # -e SMARTLEAD_WEBHOOK_SECRET="<your_secret>" # Optional
      --name sl-twenty-int \
      your-image-name
    ```
    *(Note: Ensure the `TWENTY_API_URL` is reachable from within the Docker container, e.g., using Docker networking or the host IP)*

## Deployment (Example: Render)

*   Deploy as a Node.js Web Service on Render.
*   Point Render to the `smartlead-twenty-integration` subdirectory.
*   Set the Build Command: `npm install && npm run build`
*   Set the Start Command: `node dist/index.js`
*   Configure Environment Variables (`TWENTY_API_URL`, `TWENTY_API_TOKEN`, etc.) using Render's Environment settings. 