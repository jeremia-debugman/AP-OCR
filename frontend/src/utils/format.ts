export const formatCurrency = (n: number | null | undefined): string => {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return '₹' + Number(n).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

export const getStatusBadgeClass = (status: string): string => {
  switch (status.toLowerCase()) {
    case 'draft':
      return 'bg-[#F0F1F4] text-[#5B6472]';
    case 'submitted':
      return 'bg-[#FDF1DE] text-[#B4700A]';
    case 'approved':
      return 'bg-[#E7F8EF] text-[#0F9D63]';
    case 'rejected':
      return 'bg-[#FCEBEC] text-[#C22638]';
    case 'cancelled':
      return 'bg-[#F0F1F4] text-[#5B6472] line-through';
    default:
      return 'bg-[#F0F1F4] text-[#5B6472]';
  }
};
