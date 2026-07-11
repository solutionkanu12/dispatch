import React, { forwardRef, useState } from 'react';

/**
 * Request input + submit, matching the prototype's hero form exactly. The
 * input ref is forwarded so the parent (App) can measure its position as the
 * packet animation's launch origin.
 */
const RequestForm = forwardRef(function RequestForm({ onSubmit, isSubmitting, error }, inputRef) {
  const [value, setValue] = useState('');

  function handleSubmit(e) {
    e.preventDefault();
    const text = value.trim();
    if (!text || isSubmitting) return;
    onSubmit(text);
    setValue('');
  }

  return (
    <div className="max-w-[600px]">
      <form onSubmit={handleSubmit} className="flex gap-3">
        <div className="field-focus flex flex-1 items-center rounded-2xl border-[1.5px] border-line2 bg-panel px-[18px]">
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="verify that 7919 is prime"
            disabled={isSubmitting}
            className="flex-1 bg-transparent py-[17px] font-sans text-[15px] text-cream outline-none placeholder:text-muted disabled:opacity-60"
          />
        </div>
        <button
          type="submit"
          disabled={isSubmitting}
          className="btn-press font-display rounded-2xl border-none bg-ember px-7 text-[15px] font-semibold text-[#1a1207] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? 'Dispatching…' : 'Dispatch'}
        </button>
      </form>
      {error && <p className="mt-3 text-[13px] text-fail">{error}</p>}
    </div>
  );
});

export default RequestForm;
