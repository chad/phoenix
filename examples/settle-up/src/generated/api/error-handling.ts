export interface ErrorResponse {
  error: {
    code: string;
    message: string;
  };
}

export interface ValidationError {
  field: string;
  message: string;
}

export interface DetailedErrorResponse extends ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: ValidationError[];
  };
}

export class PhoenixError extends Error {
  constructor(
    public readonly code: string,
    public readonly statusCode: number,
    message: string,
    public readonly details?: ValidationError[]
  ) {
    super(message);
    this.name = 'PhoenixError';
  }

  toJSON(): ErrorResponse | DetailedErrorResponse {
    const response: ErrorResponse | DetailedErrorResponse = {
      error: {
        code: this.code,
        message: this.message,
      },
    };

    if (this.details && this.details.length > 0) {
      (response as DetailedErrorResponse).error.details = this.details;
    }

    return response;
  }
}

export function createNotFoundError(resource: string = 'Resource'): PhoenixError {
  return new PhoenixError(
    'NOT_FOUND',
    404,
    `${resource} not found`
  );
}

export function createGroupNotFoundError(): PhoenixError {
  return new PhoenixError(
    'GROUP_NOT_FOUND',
    404,
    'Group identifier is invalid'
  );
}

export function createForbiddenError(reason: string = 'Access denied'): PhoenixError {
  return new PhoenixError(
    'FORBIDDEN',
    403,
    reason
  );
}

export function createMemberAccessError(): PhoenixError {
  return new PhoenixError(
    'MEMBER_ACCESS_DENIED',
    403,
    'Invalid member who is not in the group cannot access this resource'
  );
}

export function createBadRequestError(message: string, details?: ValidationError[]): PhoenixError {
  return new PhoenixError(
    'BAD_REQUEST',
    400,
    message,
    details
  );
}

export function createExpenseValidationError(issues: ValidationError[]): PhoenixError {
  return new PhoenixError(
    'EXPENSE_VALIDATION_ERROR',
    400,
    'Expense data validation failed',
    issues
  );
}

export function createNegativeAmountError(): PhoenixError {
  return new PhoenixError(
    'NEGATIVE_AMOUNT',
    400,
    'Expense amounts cannot be negative',
    [{ field: 'amount', message: 'Amount must be greater than zero' }]
  );
}

export function createMissingParticipantsError(): PhoenixError {
  return new PhoenixError(
    'MISSING_PARTICIPANTS',
    400,
    'Expense must have at least one participant',
    [{ field: 'participants', message: 'At least one participant is required' }]
  );
}

export function createConflictError(message: string): PhoenixError {
  return new PhoenixError(
    'CONFLICT',
    409,
    message
  );
}

export function createNonZeroBalanceError(memberName: string, balance: number): PhoenixError {
  return new PhoenixError(
    'NON_ZERO_BALANCE',
    409,
    `Cannot remove member ${memberName} with non-zero balance of ${balance}`
  );
}

export function validateExpenseData(expenseData: {
  amount?: number;
  participants?: string[];
}): ValidationError[] {
  const errors: ValidationError[] = [];

  if (typeof expenseData.amount === 'number' && expenseData.amount < 0) {
    errors.push({
      field: 'amount',
      message: 'Amount must be greater than zero'
    });
  }

  if (!expenseData.participants || expenseData.participants.length === 0) {
    errors.push({
      field: 'participants',
      message: 'At least one participant is required'
    });
  }

  return errors;
}

export function handleExpenseValidation(expenseData: {
  amount?: number;
  participants?: string[];
}): void {
  const validationErrors = validateExpenseData(expenseData);
  
  if (validationErrors.length > 0) {
    throw createExpenseValidationError(validationErrors);
  }
}

export function isPhoenixError(error: unknown): error is PhoenixError {
  return error instanceof PhoenixError;
}

export function formatErrorResponse(error: unknown): ErrorResponse | DetailedErrorResponse {
  if (isPhoenixError(error)) {
    return error.toJSON();
  }

  return {
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred'
    }
  };
}

export function getStatusCode(error: unknown): number {
  if (isPhoenixError(error)) {
    return error.statusCode;
  }
  return 500;
}

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: '5b06984fefd4888f917d13b13c21bb66490bb8c66bb61fc86a457bcc59694904',
  name: 'Error Handling',
  risk_tier: 'medium',
  canon_ids: [5 as const],
} as const;