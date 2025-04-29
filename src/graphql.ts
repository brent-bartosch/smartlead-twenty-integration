// src/graphql.ts

// Query to find a company by filter (name or domain)
export const FIND_COMPANY_QUERY = `
  query FindCompany($filter: CompanyFilterInput!) {
    companies(filter: $filter, first: 1) {
      edges {
        node { id name }
      }
    }
  }
`;

// Mutation to create one or more companies
export const CREATE_COMPANY_MUTATION = `
  mutation CreateCompany($input: CompanyCreateInput!) {
    createCompanies(data: [$input]) { 
      id 
      name 
      # Add other fields if needed in the response
    }
  }
`;

// Query to find a person by email
export const FIND_PERSON_QUERY = `
  query FindPersonByEmail($email: String!) {
    people(filter: { emails: { primaryEmail: { eq: $email } } }, first: 1) {
      edges {
        node { id }
      }
    }
  }
`;

// Mutation to create a person
export const CREATE_PERSON_MUTATION = `
  mutation CreatePerson($input: PersonCreateInput!) {
    createPerson(data: $input) { 
      id 
      # Add other fields if needed in the response
    }
  }
`;

// Mutation to create an opportunity
export const CREATE_OPPORTUNITY_MUTATION = `
  mutation CreateOpportunity($input: OpportunityCreateInput!) {
    createOpportunity(data: $input) { 
      id 
      stage 
      # Add other fields if needed in the response
    }
  }
`;

// Mutation to create a note
export const CREATE_NOTE_MUTATION = `
  mutation CreateNoteMinimal($input: NoteCreateInput!) {
      createNote(data: $input) { 
          id # Get the Note ID
      }
  }
`;

// Mutation to create a note target (link)
export const CREATE_NOTE_TARGET_MUTATION = `
  mutation CreateNoteTarget($input: NoteTargetCreateInput!) {
      createNoteTarget(data: $input) {
           id # Get target ID back 
      }
  }
`; 