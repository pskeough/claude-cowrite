import { Allotment } from 'allotment';
import 'allotment/dist/style.css';
import type { ReactNode } from 'react';

interface Props {
  left: ReactNode;
  center: ReactNode;
  right: ReactNode;
}

export default function Layout({ left, center, right }: Props) {
  return (
    <Allotment proportionalLayout>
      <Allotment.Pane minSize={200} preferredSize={280}>
        {left}
      </Allotment.Pane>
      <Allotment.Pane minSize={300}>
        {center}
      </Allotment.Pane>
      <Allotment.Pane minSize={250} preferredSize={350}>
        {right}
      </Allotment.Pane>
    </Allotment>
  );
}
