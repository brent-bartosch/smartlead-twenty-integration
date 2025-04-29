import axios from 'axios';

// Load dotenv here as well to ensure env vars are available if this module is loaded standalone
// Although the primary loading happens in index.ts
import dotenv from 'dotenv';
dotenv.config();

// --- Helper function for retry delay ---
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// --- Constants for Retry Logic ---
const MAX_RETRIES = 3;
const INITIAL_DELAY_MS = 200;

/**
 * Executes a GraphQL query or mutation against the Twenty API with retry logic.
 * @param query The GraphQL query or mutation string.
 * @param variables Optional variables object for the query/mutation.
 * @returns The data object from the GraphQL response.
 * @throws Throws an error if the API URL or Token is not configured, or if the API call fails.
 */
export const callTwentyApi = async <T = any>(
  query: string,
  variables?: Record<string, any>
): Promise<T> => {

  // Read environment variables INSIDE the function call
  const TWENTY_API_URL = process.env.TWENTY_API_URL;
  const TWENTY_API_TOKEN = process.env.TWENTY_API_TOKEN;

  if (!TWENTY_API_URL || !TWENTY_API_TOKEN) {
    // Log which specific variable is missing for better debugging
    if (!TWENTY_API_URL) console.error("Environment variable TWENTY_API_URL is not set.");
    if (!TWENTY_API_TOKEN) console.error("Environment variable TWENTY_API_TOKEN is not set.");
    throw new Error('Twenty API URL or Token is not configured in .env file.');
  }

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${TWENTY_API_TOKEN}`,
  };

  const body = {
    query,
    variables: variables || {},
  };

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`Calling Twenty API (Attempt ${attempt}/${MAX_RETRIES}) at ${TWENTY_API_URL}...`);
      console.log(`Query: ${query.substring(0, 100)}...`); // Log beginning of query
      console.log(`Variables: ${JSON.stringify(variables)}`);

      const response = await axios.post(
        TWENTY_API_URL,
        body,
        { headers, timeout: 15000 } // Add a timeout (e.g., 15 seconds)
      );

      // Check for GraphQL errors first
      if (response.data.errors) {
        console.error(`GraphQL Errors (Attempt ${attempt}):`, JSON.stringify(response.data.errors, null, 2));
        const errorMessages = response.data.errors.map((err: any) => err.message).join('; ');
        // Treat GraphQL errors as non-retryable immediately
        throw new Error(`GraphQL Error: ${errorMessages}`); 
      }
      
      // Check for non-2xx HTTP status codes that might indicate temporary server issues
      if (response.status >= 500) {
          console.warn(`Received server error status ${response.status} (Attempt ${attempt}). Retrying...`);
          lastError = new Error(`API Request Failed with status ${response.status}`);
          // Continue to retry logic below
      } else if (response.status >= 400) {
           // Treat client errors (4xx) as non-retryable (except maybe 429 Too Many Requests in future)
           console.error(`Received client error status ${response.status} (Attempt ${attempt}). Not retrying.`);
           console.error('Response Data:', JSON.stringify(response.data, null, 2));
           throw new Error(`API Request Failed: Client Error (Status: ${response.status})`);
      } else {
            // Success (2xx status code and no GraphQL errors)
            console.log('Twenty API Call Successful.');
            return response.data.data; // Return the actual data payload
      }

    } catch (error: any) {
        lastError = error; // Store the error encountered
        console.error(`Error calling Twenty API (Attempt ${attempt}):`, error.message);

        // Check if it's a retryable error (network error, timeout, 5xx status)
        const isRetryable = 
            (axios.isAxiosError(error) && 
                (!error.response || // Network error / Timeout
                 error.response.status >= 500)) || // Server error
            (error.message?.includes('timeout')); // Explicit timeout check

        if (!isRetryable || attempt === MAX_RETRIES) {
            console.error(`Non-retryable error or max retries reached. Failing operation.`);
            if (axios.isAxiosError(error)) {
              console.error('Final Status:', error.response?.status);
              console.error('Final Response Data:', JSON.stringify(error.response?.data, null, 2));
              console.error('Final Request Body:', JSON.stringify(body, null, 2));
              // Throw a more specific error if possible
              throw new Error(`API Request Failed after ${attempt} attempts: ${error.message} (Status: ${error.response?.status || 'N/A'})`);
            } else {
              // Rethrow non-Axios errors or GraphQL errors
              throw error; 
            }
        }
        // If retryable and not max retries, wait and continue loop
        const delayTime = INITIAL_DELAY_MS * Math.pow(2, attempt - 1); // Exponential backoff
        console.log(`Retryable error encountered. Waiting ${delayTime}ms before next attempt...`);
        await delay(delayTime); 
    }
  } // End of retry loop
  
  // Should not be reached if successful, but satisfies TypeScript compiler
  // Throw the last encountered error if loop finishes without success
  throw lastError || new Error('API call failed after all retries.');
}; 