import { ForbiddenException } from '@nestjs/common';
import { MobileService } from './mobile.service';

describe('MobileService assignee IDOR', () => {
  it('rejects lead detail when assignedToId does not match caller', async () => {
    const leads = {
      findOne: jest.fn().mockResolvedValue({
        id: 'lead-1',
        assignedToId: 'other-user',
        companyId: 'c1',
      }),
    };
    const service = Object.create(MobileService.prototype) as MobileService;
    (service as any).leads = leads;

    await expect(service.getLead('lead-1', 'me', 'c1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('allows lead detail for assignee', async () => {
    const lead = { id: 'lead-1', assignedToId: 'me', companyId: 'c1' };
    const leads = { findOne: jest.fn().mockResolvedValue(lead) };
    const service = Object.create(MobileService.prototype) as MobileService;
    (service as any).leads = leads;

    await expect(service.getLead('lead-1', 'me', 'c1')).resolves.toEqual(lead);
  });
});
