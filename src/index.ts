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
    CREATE_NOTE_TARGET_MUTATION,
    CREATE_TASK_MUTATION,
    CREATE_TASK_TARGET_MUTATION
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
    
    // --- Define Categories & Mappings --- 
    const positiveSmartleadCategories = ['Interested', 'Information Request', 'Meeting Request'];
    const smartleadToTwentyStageMap: { [key: string]: string } = {
        'Interested': 'INTERESTED',
        'Information Request': 'INFORMATIONREQUEST',
        'Meeting Request': 'MEETINGREQUEST',
        // Add other mappings here if SmartLead sends different values that map to other Twenty stages
    };

    const currentSmartleadCategory = payload.lead_category?.new_name;
    const eventType = payload.event_type;

    console.log(`[DEBUG] Processing SmartLead webhook. Event: '${eventType}', Category: '${currentSmartleadCategory}'`);

    // --- Extract Data from Payload --- (Adjust based on actual payload structure)
    const leadData = payload.lead_data;
    if (!leadData || !leadData.email) {
        console.warn('[DEBUG] /webhooks/smartlead: Missing lead_data or email. Cannot process further.');
        // Acknowledge webhook even if data is incomplete to prevent SmartLead retries for bad data
        return res.status(200).json({ success: true, message: 'Webhook acknowledged, but missing essential lead_data or email.' });
    }
    console.log('[DEBUG] /webhooks/smartlead: Extracting lead data');
    const leadEmail = leadData.email;
    const firstName = leadData.first_name || ''; 
    const lastName = leadData.last_name || '';  
    const companyName = leadData.company_name;
    const website = leadData.website;
    const jobTitle = leadData.jobTitle; 
    const city = leadData.city;         

    let companyDomain: string | undefined;
    console.log('[DEBUG] /webhooks/smartlead: Determining company domain');
    if (website) {
        try {
            const url = new URL(website);
            companyDomain = url.hostname.replace(/^www\./, '');
            console.log(`[DEBUG] /webhooks/smartlead: Derived domain: ${companyDomain}`);
        } catch (e) { 
            console.warn(`[DEBUG] /webhooks/smartlead: Could not parse website URL: ${website}`, e);
        }
    } else if (companyName) {
        console.log(`[DEBUG] /webhooks/smartlead: No website for ${companyName}, will find by name.`);
    }

    // --- 1. Find or Create Company --- 
    let companyId: string | null = null;
    console.log('[DEBUG] /webhooks/smartlead: Starting Find/Create Company');

    const companyFilter = companyDomain
        ? { domainName: { primaryLinkUrl: { eq: companyDomain } } } 
        : (companyName ? { name: { eq: companyName } } : null);

    if (companyFilter) {
        console.log(`[DEBUG] /webhooks/smartlead: Searching company with filter: ${JSON.stringify(companyFilter)}`);
        const findResult = await callTwentyApi<{ companies: { edges: { node: { id: string } }[] } }>(
            FIND_COMPANY_QUERY,
            { filter: companyFilter }
        );

        if (findResult?.companies?.edges?.length > 0) {
            companyId = findResult.companies.edges[0].node.id;
            console.log(`[DEBUG] /webhooks/smartlead: Found company ID: ${companyId}`);
        } else if (companyName) { 
            console.log(`[DEBUG] /webhooks/smartlead: Company not found. Creating: ${companyName}`);
            const companyInput: any = { name: companyName };
            if (companyDomain) {
                 companyInput.domainName = { primaryLinkUrl: `https://${companyDomain}` };
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
                // Don't throw here, allow person creation and note/task logging
            }
        }
    } else {
        console.log('[DEBUG] /webhooks/smartlead: No company name or domain, cannot find/create company.');
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
    } else {
        console.log(`[DEBUG] /webhooks/smartlead: Person not found. Creating: ${firstName} ${lastName}`);
        const personInput: any = {
            name: { firstName, lastName },
            emails: { primaryEmail: leadEmail },
        };
        if (companyId) { // Only link if company was found/created
            personInput.companyId = companyId;
        }
        if (jobTitle) personInput.jobTitle = jobTitle;
        if (city) personInput.city = city;

        const createPersonResult = await callTwentyApi<{ createPerson: { id: string } }>(
            CREATE_PERSON_MUTATION,
            { input: personInput }
        );
        personId = createPersonResult?.createPerson?.id;

        if (!personId) {
            console.error('[DEBUG] /webhooks/smartlead: Failed to create person', createPersonResult);
            // Don't throw here, allow note/task logging even if person creation fails
        } else {
            console.log(`[DEBUG] /webhooks/smartlead: Created person ID: ${personId}`);
        }
    }
    
    let opportunityId: string | null = null; // To store Opp ID if created

    // --- 3. Process based on SmartLead Category ---
    if (eventType === 'LEAD_CATEGORY_UPDATED' && currentSmartleadCategory && positiveSmartleadCategories.includes(currentSmartleadCategory)) {
        // --- Create Opportunity for Positive Categories ---
        console.log(`[DEBUG] Positive category '${currentSmartleadCategory}'. Creating Opportunity.`);
        if (!companyId) {
            console.warn(`[DEBUG] Skipping opportunity: companyId not determined for person ${personId}. An Opp requires a company.`);
        } else if (!personId) {
             console.warn(`[DEBUG] Skipping opportunity: personId not determined. An Opp requires a person.`);
        } else {
            const twentyStage = smartleadToTwentyStageMap[currentSmartleadCategory] || 'INTERESTED'; // Default to INTERESTED if mapping missing
            console.log(`[DEBUG] Creating opportunity for person ${personId} at company ${companyId}, stage: ${twentyStage}`);
            
            const opportunityInput: any = {
                stage: twentyStage, 
                companyId: companyId,
                pointOfContactId: personId,
                name: `Deal for ${firstName} ${lastName} (${currentSmartleadCategory})` // Add category to name
            };

            try {
                const createOppResult = await callTwentyApi<{ createOpportunity: { id: string, stage: string } }>(
                    CREATE_OPPORTUNITY_MUTATION,
                    { input: opportunityInput }
                );

                if (createOppResult?.createOpportunity?.id) {
                    opportunityId = createOppResult.createOpportunity.id;
                    console.log(`[DEBUG] Created opportunity ID: ${opportunityId} in stage ${createOppResult.createOpportunity.stage}`);
                } else {
                     console.error('[DEBUG] Failed to create opportunity', createOppResult);
                     // Log error but continue to create note
                }
            } catch (oppError: any) {
                console.error(`[DEBUG] Error creating opportunity: ${oppError.message}`);
                // Log error but continue to create note
            }
        }
    } else if (personId) { // For non-positive, or if not LEAD_CATEGORY_UPDATED but we have a person
        // --- Create Task for Review for Other Categories ---
        const taskTitle = `SmartLead: Review ${currentSmartleadCategory || eventType || 'Interaction'}`;
        console.log(`[DEBUG] Category '${currentSmartleadCategory}' not positive or event type '${eventType}' not an Opp trigger. Creating Task: "${taskTitle}"`);

        if (!personId && !companyId) {
            console.warn(`[DEBUG] Skipping task creation: Neither personId nor companyId is available.`);
        } else {
            const taskInput = {
                title: taskTitle,
                status: 'TODO', // Or 'OPEN', 'NEW' depending on Twenty's Task status enum
                // description: `SmartLead event: ${eventType}. Category: ${currentSmartleadCategory || 'N/A'}. Lead: ${leadEmail}`,
                // dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0] // Example: Due tomorrow
            };
            try {
                const createTaskResult = await callTwentyApi<{ createTask: { id: string } }>(
                    CREATE_TASK_MUTATION,
                    { input: taskInput }
                );
                const taskId = createTaskResult?.createTask?.id;

                if (taskId) {
                    console.log(`[DEBUG] Created task ID: ${taskId}. Now creating task targets.`);
                    const taskTargetsToCreate = [];
                    if (personId) taskTargetsToCreate.push({ taskId, personId });
                    if (companyId) taskTargetsToCreate.push({ taskId, companyId });

                    for (const targetInput of taskTargetsToCreate) {
                        try {
                            await callTwentyApi(CREATE_TASK_TARGET_MUTATION, { input: targetInput });
                            console.log(`[DEBUG] Successfully created TaskTarget for ${Object.keys(targetInput).find(k => k !== 'taskId')}`);
                        } catch (targetError: any) {
                            console.warn(`[DEBUG] Failed to create TaskTarget ${JSON.stringify(targetInput)}: ${targetError.message}`);
                        }
                    }
                } else {
                    console.warn('[DEBUG] Failed to create task or extract ID.', createTaskResult);
                }
            } catch (taskError: any) {
                console.warn(`[DEBUG] Error creating task: ${taskError.message}`);
            }
        }
    } else {
        console.log(`[DEBUG] No specific action (Opp/Task) for category '${currentSmartleadCategory}' or event '${eventType}'. Person/Company might have been created/found if data was present.`);
    }

    // --- 4. Always Create an Activity Log (Note) if person or company exists ---
    // This note logs the raw event.
    if (personId || companyId) {
        try {
            console.log(`[DEBUG] Creating activity log note for event '${eventType}', category '${currentSmartleadCategory}'...`);
            const noteTitle = `SmartLead: ${currentSmartleadCategory || eventType || 'Interaction Event'}`;
            let noteBodyText = `SmartLead webhook received. Event: '${eventType}'.`;
            if (currentSmartleadCategory) {
                noteBodyText += ` Category: '${currentSmartleadCategory}'.`;
            }
            noteBodyText += ` Lead: ${leadEmail}.`;
            if (payload.email_content && payload.email_content.subject) {
                 noteBodyText += ` Subject: "${payload.email_content.subject}"`;
            }


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
                console.warn('[DEBUG] Failed to create generic activity log note or extract ID.', createNoteResult);
            } else {
                console.log(`[DEBUG] Created generic activity log note with ID: ${noteId}. Now creating targets.`);
                
                const noteTargetsToCreate = [];
                if (personId) noteTargetsToCreate.push({ noteId, personId });
                if (companyId) noteTargetsToCreate.push({ noteId, companyId });
                if (opportunityId) noteTargetsToCreate.push({ noteId, opportunityId }); // Link to Opp if created

                for (const targetInput of noteTargetsToCreate) {
                    try {
                        await callTwentyApi(CREATE_NOTE_TARGET_MUTATION, { input: targetInput });
                        console.log(`[DEBUG] Successfully created NoteTarget for ${Object.keys(targetInput).find(k => k !== 'noteId')}`);
                    } catch (targetError: any) {
                        console.warn(`[DEBUG] Failed to create NoteTarget for generic note ${JSON.stringify(targetInput)}: ${targetError.message}`);
                    }
                }
            }
        } catch (noteError: any) {
             console.warn(`[DEBUG] Failed to create generic activity log note: ${noteError.message}`);
        }
    }


    console.log('[DEBUG] /webhooks/smartlead: Processing complete, sending 200.');
    res.status(200).json({ success: true, message: 'Webhook processed successfully' });

  } catch (error: any) {
    console.error('[DEBUG] /webhooks/smartlead: Error in try block:', error.message, error.stack);
    next(error); 
  }
});

// --- Basic Error Handler ---
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error("[DEBUG] Global Error Handler:", err.message, err.stack);
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
