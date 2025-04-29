// @ts-nocheck - Temporarily disable type checking for debugging
console.log('[DEBUG] index.ts: Top of file');

import express, { Request, Response, NextFunction } from 'express';
import dotenv from 'dotenv';
import { callTwentyApi } from './twenty'; // Import the API call function
import {
    FIND_COMPANY_QUERY,
    CREATE_COMPANY_MUTATION,
    FIND_PERSON_QUERY,
    CREATE_PERSON_MUTATION,
    CREATE_OPPORTUNITY_MUTATION,
    CREATE_NOTE_MUTATION,
    CREATE_NOTE_TARGET_MUTATION
} from './graphql'; // Import the constants

// Load environment variables from .env file
console.log('[DEBUG] index.ts: Loading dotenv');
dotenv.config();
console.log('[DEBUG] index.ts: dotenv loaded');

const app = express();
console.log('[DEBUG] index.ts: Express app created');

// Middleware to parse JSON bodies
app.use(express.json());
console.log('[DEBUG] index.ts: JSON middleware added');

const PORT = process.env.PORT || 3002; // Default to 3002 if PORT not set
const SMARTLEAD_WEBHOOK_SECRET = process.env.SMARTLEAD_WEBHOOK_SECRET;
console.log(`[DEBUG] index.ts: PORT=${PORT}, SECRET_SET=${!!SMARTLEAD_WEBHOOK_SECRET}`);


// --- Simple Webhook Secret Validation Middleware (Optional but Recommended) ---
const validateWebhookSecret = (req: Request, res: Response, next: NextFunction) => {
  console.log('[DEBUG] validateWebhookSecret: Entered');
  const providedSecret = req.headers['x-smartlead-secret'] || req.query.secret; // Adjust header/param as needed

  // Only validate if a secret is configured in our .env
  if (SMARTLEAD_WEBHOOK_SECRET) {
    if (providedSecret !== SMARTLEAD_WEBHOOK_SECRET) {
      console.warn('[DEBUG] validateWebhookSecret: Invalid secret');
      return res.status(401).json({ error: 'Unauthorized: Invalid secret' });
    }
    console.log('[DEBUG] validateWebhookSecret: Secret validated successfully');
  } else {
    console.warn('[DEBUG] validateWebhookSecret: Secret not set, skipping validation');
  }
  console.log('[DEBUG] validateWebhookSecret: Calling next()');
  next();
};

// --- SmartLead Webhook Endpoint ---
app.post('/webhooks/smartlead', validateWebhookSecret, async (req: Request, res: Response, next: NextFunction) => {
  console.log('[DEBUG] /webhooks/smartlead: Received POST request');
  console.log('Received SmartLead Webhook Payload:');
  console.log(JSON.stringify(req.body, null, 2));

  const payload = req.body; // Assuming body is already parsed by express.json()

  try {
    console.log('[DEBUG] /webhooks/smartlead: Entering try block');
    
    // --- Define Positive Categories --- 
    const positiveCategoryNames = ['Interested', 'Information Request', 'Meeting Request'];

    // --- Interest Check --- 
    // Trigger if category updated to one of the positive names
    const isPositiveCategoryUpdate = payload.event_type === 'LEAD_CATEGORY_UPDATED' &&
                                    payload.lead_category?.new_name &&
                                    positiveCategoryNames.includes(payload.lead_category.new_name);
    
    // TODO: Optionally add check for EMAIL_REPLY event type here as well
    // const isPositiveReply = payload.event_type === 'EMAIL_REPLY' // && some condition

    // Check if the event meets our criteria
    if (!isPositiveCategoryUpdate /* && !isPositiveReply */) { // Add reply check if implemented
      console.log(`[DEBUG] /webhooks/smartlead: Event type \'${payload.event_type}\' or category \'${payload.lead_category?.new_name}\' not actionable. Skipping.`);
      return res.status(200).json({ success: true, message: 'Webhook received, not processed (condition not met)' });
    }

    console.log(`Positive interaction detected (Category: ${payload.lead_category?.new_name || 'N/A'}, Event: ${payload.event_type}), processing lead...`);

    // --- Extract Data from Payload --- (Adjust based on actual payload structure)
    const leadData = payload.lead_data;
    if (!leadData || !leadData.email) {
        console.error('[DEBUG] /webhooks/smartlead: Missing lead_data or email');
        throw new Error('Webhook payload missing essential lead_data or email.');
    }
    console.log('[DEBUG] /webhooks/smartlead: Extracting lead data');
    const leadEmail = leadData.email;
    const firstName = leadData.first_name || ''; // Default to empty if missing
    const lastName = leadData.last_name || '';  // Default to empty if missing
    const companyName = leadData.company_name;
    const website = leadData.website;
    const jobTitle = leadData.jobTitle; // Check if this field exists in your payload
    const city = leadData.city;         // Check if this field exists

    // Determine domain for company lookup (simple extraction, might need refinement)
    let companyDomain: string | undefined;
    console.log('[DEBUG] /webhooks/smartlead: Determining company domain');
    if (website) {
        try {
            // @ts-ignore - URL might not be available in all Node versions without explicit import
            const url = new URL(website);
            companyDomain = url.hostname.replace(/^www\./, '');
            console.log(`[DEBUG] /webhooks/smartlead: Derived domain: ${companyDomain}`);
        } catch (e) { // Ignore invalid URLs
            console.warn(`[DEBUG] /webhooks/smartlead: Could not parse website URL: ${website}`, e);
        }
    } else if (companyName) {
        // Basic fallback: try using company name if no website
        // This is less reliable for lookup
        console.log(`[DEBUG] /webhooks/smartlead: No website for ${companyName}, will find by name.`);
    }

    // --- 1. Find or Create Company --- 
    let companyId: string | null = null;
    console.log('[DEBUG] /webhooks/smartlead: Starting Find/Create Company');

    // Prioritize finding by domain if available
    const filter = companyDomain
        ? { domainName: { primaryLinkUrl: { eq: companyDomain } } } 
        : (companyName ? { name: { eq: companyName } } : null); // Handle null case

    if (filter) { // Only search if we have domain or name
        console.log(`[DEBUG] /webhooks/smartlead: Searching company with filter: ${JSON.stringify(filter)}`);
        const findResult = await callTwentyApi<{ companies: { edges: { node: { id: string } }[] } }>(
            FIND_COMPANY_QUERY,
            { filter }
        );

        if (findResult?.companies?.edges?.length > 0) {
            companyId = findResult.companies.edges[0].node.id;
            console.log(`[DEBUG] /webhooks/smartlead: Found company ID: ${companyId}`);
        } else if (companyName) { // Only create if not found AND we have a name
            console.log(`[DEBUG] /webhooks/smartlead: Company not found. Creating: ${companyName}`);
            const companyInput: any = { name: companyName };
            if (companyDomain) { // Add domain if we derived it
                 companyInput.domainName = { primaryLinkUrl: `https://${companyDomain}` }; // Assume https
            }

            const createResult = await callTwentyApi<{ createCompanies: { id: string }[] }>(
                CREATE_COMPANY_MUTATION,
                { input: companyInput }
            );
            if (createResult?.createCompanies?.length > 0) {
                 companyId = createResult.createCompanies[0].id;
                 console.log(`[DEBUG] /webhooks/smartlead: Created company ID: ${companyId}`);
            } else {
                console.error('[DEBUG] /webhooks/smartlead: Failed to create company', createResult);
                throw new Error('Failed to create company.');
            }
        }
    } else {
        console.log('[DEBUG] /webhooks/smartlead: No company name or domain, cannot find/create.');
    }

    // --- 2. Find or Create Person ---
    let personId: string | null = null;
    console.log('[DEBUG] /webhooks/smartlead: Starting Find/Create Person');

    console.log(`[DEBUG] /webhooks/smartlead: Searching person by email: ${leadEmail}`);
    const findPersonResult = await callTwentyApi<{ people: { edges: { node: { id: string } }[] } }>(
        FIND_PERSON_QUERY,
        { email: leadEmail }
    );

    if (findPersonResult?.people?.edges?.length > 0) {
        personId = findPersonResult.people.edges[0].node.id;
        console.log(`[DEBUG] /webhooks/smartlead: Found person ID: ${personId}`);
        // TODO: Optionally update the existing person's details here if necessary
    } else {
        console.log(`[DEBUG] /webhooks/smartlead: Person not found. Creating: ${firstName} ${lastName}`);
        const personInput: any = {
            name: { firstName, lastName },
            emails: { primaryEmail: leadEmail },
        };
        if (companyId) {
            personInput.companyId = companyId;
        }
        if (jobTitle) {
            personInput.jobTitle = jobTitle;
        }
        if (city) {
            personInput.city = city;
        }

        const createPersonResult = await callTwentyApi<{ createPerson: { id: string } }>(
            CREATE_PERSON_MUTATION,
            { input: personInput }
        );
        personId = createPersonResult?.createPerson?.id;

        if (!personId) {
            console.error('[DEBUG] /webhooks/smartlead: Failed to create person', createPersonResult);
            throw new Error('Failed to create person.');
        }
        console.log(`[DEBUG] /webhooks/smartlead: Created person ID: ${personId}`);
    }

    // --- 3. Create Opportunity --- 
    console.log('[DEBUG] /webhooks/smartlead: Starting Create Opportunity');
    if (!companyId) {
        console.warn(`[DEBUG] Skipping opportunity: companyId not determined for person ${personId}`);
    } else if (!personId) {
         console.warn(`[DEBUG] Skipping opportunity: personId not determined.`); // Should not happen if logic above is correct
    } else {
        console.log(`[DEBUG] Creating opportunity for person ${personId} at company ${companyId}`);
        const opportunityInput: any = {
            stage: 'INTERESTED', // Use the correct uppercase enum value
            companyId: companyId,
            pointOfContactId: personId,
            name: `Deal for ${firstName} ${lastName}` // Auto-generate a name
        };

        const createOppResult = await callTwentyApi<{ createOpportunity: { id: string, stage: string } }>(
            CREATE_OPPORTUNITY_MUTATION,
            { input: opportunityInput }
        );

        if (!createOppResult?.createOpportunity?.id) {
             console.error('[DEBUG] Failed to create opportunity', createOppResult);
             throw new Error('Failed to create opportunity.');
        }
        console.log(`[DEBUG] Created opportunity ID: ${createOppResult.createOpportunity.id} in stage ${createOppResult.createOpportunity.stage}`);
        const opportunityId = createOppResult.createOpportunity.id;

        // --- 4. Create Activity Log (Note) ---
        try {
            console.log(`[DEBUG] Creating activity log note...`);
            const noteTitle = `SmartLead: ${payload.lead_category?.new_name || 'Interaction'}`;
            const noteBodyText = `Webhook event \'${payload.event_type}\' received. Category set to \'${payload.lead_category?.new_name || 'N/A'}\' for lead ${leadEmail}.`;
            const noteInput = {
                title: noteTitle,
                bodyV2: {
                    blocknote: JSON.stringify([{ type: 'paragraph', content: noteBodyText }]),
                    markdown: noteBodyText
                }
            };

            const createNoteResult = await callTwentyApi<{ createNote: { id: string } }>(
                CREATE_NOTE_MUTATION,
                { input: noteInput }
            );
            const noteId = createNoteResult?.createNote?.id;

            if (!noteId) {
                console.warn('[DEBUG] Failed to create note or extract ID.', createNoteResult);
            } else {
                console.log(`[DEBUG] Created note with ID: ${noteId}. Now creating targets.`);
                
                // --- 5. Create Note Targets (Linking) ---
                const targetsToCreate = [];
                if (personId) targetsToCreate.push({ noteId, personId });
                if (companyId) targetsToCreate.push({ noteId, companyId });
                if (opportunityId) targetsToCreate.push({ noteId, opportunityId });

                // Create targets sequentially (could be parallelized with Promise.all if needed)
                for (const targetInput of targetsToCreate) {
                    try {
                        console.log(`[DEBUG] Creating NoteTarget: ${JSON.stringify(targetInput)}`);
                        await callTwentyApi(
                            CREATE_NOTE_TARGET_MUTATION,
                            { input: targetInput }
                        );
                        console.log(`[DEBUG] Successfully created NoteTarget for ${Object.keys(targetInput).find(k => k !== 'noteId')}`);
                    } catch (targetError: any) {
                        console.warn(`[DEBUG] Failed to create NoteTarget ${JSON.stringify(targetInput)}: ${targetError.message}`);
                        // Decide if failure to link one target is critical - currently just warns
                    }
                }
            }
        } catch (noteError: any) {
             // Log note creation error but don't fail the whole webhook
             console.warn(`[DEBUG] Failed to create activity log note: ${noteError.message}`);
        }

    }

    // Send success response to SmartLead
    console.log('[DEBUG] /webhooks/smartlead: Processing complete, sending 200.');
    res.status(200).json({ success: true, message: 'Webhook processed successfully' });

  } catch (error: any) {
    console.error('[DEBUG] /webhooks/smartlead: Error in try block:', error.message);
    // Pass the error to the global error handler
    next(error); 
  }
});

// --- Basic Error Handler ---
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error("[DEBUG] Global Error Handler:", err);
  // Avoid sending detailed errors back normally, but maybe useful for debugging
  res.status(500).json({ error: 'Internal Server Error', message: err.message }); 
});

// --- Start the server ---
console.log('[DEBUG] index.ts: Setting up app.listen');
app.listen(PORT, () => {
  console.log(`[DEBUG] index.ts: Server listening callback triggered on port ${PORT}`);
  console.log(`SmartLead-Twenty Integration Service listening on port ${PORT}`);
  console.log(`Webhook endpoint available at: http://localhost:${PORT}/webhooks/smartlead`);
  if (!process.env.TWENTY_API_TOKEN) {
    console.warn('Warning: TWENTY_API_TOKEN is not set in the .env file!');
  }
   if (!SMARTLEAD_WEBHOOK_SECRET) {
    console.warn('Warning: SMARTLEAD_WEBHOOK_SECRET not set in the .env file. Webhook validation disabled.');
  }
}); 

console.log('[DEBUG] index.ts: Bottom of file, after app.listen call');
